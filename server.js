const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8765;
const DIR = path.join(__dirname, 'public');

const TYPES = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.pdf':  'application/pdf',
};

const UPLOADS_DIR = path.join(DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

let serverStatus = { status: 'initializing' };

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── GET /api/status ──────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(serverStatus));
    return;
  }

  // ── Ollama Proxy (/api/ollama/*) ─────────────────────────────────────────
  // Forwards all Ollama API calls through this server so remote users (ngrok)
  // only need ONE URL — no second tunnel needed.
  if (req.url.startsWith('/api/ollama/')) {
    const ollamaPath = req.url.replace('/api/ollama', ''); // e.g. /api/chat
    const https = require('http');
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const bodyData = Buffer.concat(chunks);
      const proxyReq = https.request({
        hostname: '127.0.0.1',
        port: 11434,
        path: ollamaPath,
        method: req.method,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          'Content-Length': bodyData.length
        }
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': proxyRes.headers['content-type'] || 'application/json',
          'Transfer-Encoding': proxyRes.headers['transfer-encoding'] || '',
          'Access-Control-Allow-Origin': '*'
        });
        proxyRes.pipe(res);
      });
      proxyReq.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Ollama unreachable: ' + err.message }));
      });
      proxyReq.write(bodyData);
      proxyReq.end();
    });
    return;
  }
  // ─────────────────────────────────────────────────────────────────────────

  // POST /api/rag/upload
  if (req.method === 'POST' && req.url === '/api/rag/upload') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { filename, base64 } = JSON.parse(body);
        if (!filename || !base64) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'filename and base64 data are required' }));
          return;
        }

        const buffer = Buffer.from(base64, 'base64');
        
        // Save the file for preview
        const filePath = path.join(UPLOADS_DIR, filename);
        await fs.promises.writeFile(filePath, buffer);

        const { extractText } = require('./rag/processor');
        const { indexDocument } = require('./rag/engine');

        const text = await extractText(buffer, filename);
        const chunksIndexed = await indexDocument(filename, text);

        if (chunksIndexed === 0) {
          // Delete the file since it's empty/unreadable
          try { await fs.promises.unlink(filePath); } catch(e){}
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Could not extract any readable text from this document. It might be an image or a scanned PDF.' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, chunks: chunksIndexed }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /api/rag/upload-scanned
  if (req.method === 'POST' && req.url === '/api/rag/upload-scanned') {
    let body = [];
    req.on('data', chunk => { body.push(chunk); });
    req.on('end', async () => {
      try {
        const bodyStr = Buffer.concat(body).toString();
        const { filename, images, originalFileBase64 } = JSON.parse(bodyStr);
        if (!filename || !images || !Array.isArray(images)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'filename and images array are required' }));
          return;
        }

        // Save the original file for preview/download
        const filePath = path.join(UPLOADS_DIR, filename);
        if (originalFileBase64) {
          await fs.promises.writeFile(filePath, Buffer.from(originalFileBase64, 'base64'));
        }

        const { extractImage } = require('./rag/processor');
        const { indexDocument } = require('./rag/engine');

        let fullText = '';
        for (let i = 0; i < images.length; i++) {
          const base64Data = images[i].replace(/^data:image\/\w+;base64,/, "");
          const imgBuffer = Buffer.from(base64Data, 'base64');
          const text = await extractImage(imgBuffer);
          fullText += `\n--- Page ${i + 1} ---\n` + text;
        }

        if (!fullText.trim()) {
           res.writeHead(400, { 'Content-Type': 'application/json' });
           res.end(JSON.stringify({ error: 'OCR could not find any text on these pages.' }));
           return;
        }

        const chunksIndexed = await indexDocument(filename, fullText);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, chunks: chunksIndexed }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /api/rag/query
  if (req.method === 'POST' && req.url === '/api/rag/query') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { question, topK, model } = JSON.parse(body);
        if (!question) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'question is required' }));
          return;
        }

        const { queryKnowledgeBase } = require('./rag/engine');
        const results = await queryKnowledgeBase(question, topK || 5, model);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /api/interpreter/inline
  if (req.method === 'POST' && req.url === '/api/interpreter/inline') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { filename, content, question, model } = JSON.parse(body);
        if (!filename || !content || !question) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'filename, content, and question are required' }));
          return;
        }

        const { runInlineExcelQuery } = require('./rag/data_interpreter');
        const result = await runInlineExcelQuery(filename, content, question, model);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /api/interpreter/sql
  if (req.method === 'POST' && req.url === '/api/interpreter/sql') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { filename, base64, question, model } = JSON.parse(body);
        if (!filename || !base64 || !question) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'filename, base64, and question are required' }));
          return;
        }

        const { runSQLInterpreter } = require('./rag/sql_interpreter');
        const result = await runSQLInterpreter(filename, base64, question, model);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result }));
      } catch (err) {
        console.error('[SQL Interpreter Endpoint Error]', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /api/search (Web Search Pipeline)
  if (req.method === 'POST' && req.url === '/api/search') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { request, history, model } = JSON.parse(body);
        if (!request) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'request is required' }));
          return;
        }

        const { performWebSearch, generateSearchQuery } = require('./rag/web_search');
        
        // 1. Generate optimal query
        const query = await generateSearchQuery(model, history || [], request);
        
        // 2. Perform search and extraction
        const webContext = await performWebSearch(query);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ query, context: webContext }));
      } catch (err) {
        console.error('[API Search Error]', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // GET /api/rag/documents
  if (req.method === 'GET' && req.url === '/api/rag/documents') {
    try {
      const { listDocuments } = require('./rag/engine');
      const docs = await listDocuments();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ documents: docs }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // DELETE /api/rag/documents/:name
  if (req.method === 'DELETE' && req.url.startsWith('/api/rag/documents/')) {
    try {
      const docName = decodeURIComponent(req.url.slice('/api/rag/documents/'.length));
      if (!docName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'document name is required' }));
         return;
      }

      const { deleteDocument } = require('./rag/engine');
      await deleteDocument(docName);

      // Attempt to delete the saved file as well
      const filePath = path.join(UPLOADS_DIR, docName);
      try {
        await fs.promises.unlink(filePath);
      } catch (err) {
        // Ignore if file doesn't exist
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }


  // Handle Chat API (Proxy to Ollama)
  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const http = require('http');
      const ollamaReq = http.request({
        hostname: '127.0.0.1',
        port: 11434,
        path: '/api/chat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (ollamaRes) => {
        res.writeHead(ollamaRes.statusCode, ollamaRes.headers);
        ollamaRes.pipe(res);
      });

      ollamaReq.on('error', (err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to reach local Ollama instance: ' + err.message }));
      });

      ollamaReq.write(body);
      ollamaReq.end();
    });
    return;
  }

  // Handle Tags API (Proxy to Ollama)
  if (req.method === 'GET' && req.url === '/api/tags') {
    const http = require('http');
    const ollamaReq = http.request({
      hostname: '127.0.0.1',
      port: 11434,
      path: '/api/tags',
      method: 'GET'
    }, (ollamaRes) => {
      res.writeHead(ollamaRes.statusCode, ollamaRes.headers);
      ollamaRes.pipe(res);
    });

    ollamaReq.on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to reach local Ollama instance: ' + err.message }));
    });

    ollamaReq.end();
    return;
  }



  // Serve static files
  let decodedUrl = req.url;
  try {
    decodedUrl = decodeURIComponent(req.url);
  } catch (e) {}

  let filePath = path.join(DIR, decodedUrl === '/' ? 'index.html' : decodedUrl);
  const ext = path.extname(filePath);
  const type = TYPES[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

function pullModel(name) {
  return new Promise((resolve) => {
    const pullReq = http.request({
      hostname: '127.0.0.1',
      port: 11434,
      path: '/api/pull',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (pullRes) => {
      pullRes.on('data', () => {});
      pullRes.on('end', () => {
        resolve();
      });
    });
    pullReq.on('error', () => resolve());
    pullReq.write(JSON.stringify({ name }));
    pullReq.end();
  });
}

async function autoCheckAndPullModels() {
  serverStatus = { status: 'checking' };
  
  const checkOptions = {
    hostname: '127.0.0.1',
    port: 11434,
    path: '/api/tags',
    method: 'GET'
  };

  const checkOllama = () => new Promise((resolve) => {
    const req = http.request(checkOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });

  const data = await checkOllama();
  if (!data) {
    console.warn('[Ollama] Ollama server is not running or unreachable. Retrying in 5 seconds...');
    serverStatus = { status: 'ollama_offline' };
    setTimeout(autoCheckAndPullModels, 5000);
    return;
  }

  const models = data.models || [];
  const hasQwen = models.some(m => m.name.includes('qwen2.5'));
  const hasMiniCPM = models.some(m => m.name.toLowerCase().includes('minicpm'));

  if (!hasQwen) {
    console.log('[Ollama] Qwen 2.5 model not found. Pulling qwen2.5:3b...');
    serverStatus = { status: 'downloading', model: 'qwen2.5:3b' };
    await pullModel('qwen2.5:3b');
  }

  if (!hasMiniCPM) {
    console.log('[Ollama] MiniCPM-V model not found. Pulling minicpm-v...');
    serverStatus = { status: 'downloading', model: 'minicpm-v' };
    await pullModel('minicpm-v');
  }

  console.log('[Ollama] All models checked and ready.');
  serverStatus = { status: 'ready' };
}

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ======================================');
  console.log('   MyGPT Local Server (Persistent)');
  console.log('   Running at: http://localhost:' + PORT);
  console.log('   Keep this window open!');
  console.log('  ======================================');
  console.log('');
  autoCheckAndPullModels();
});

process.on('SIGINT', () => {
  console.log('\n  Server stopped.');
  process.exit();
});
