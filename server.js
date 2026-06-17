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
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
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

  // Handle Search API
  if (req.method === 'POST' && req.url === '/api/search') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { query, apiKey } = JSON.parse(body);
        if (!query || !apiKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Query and apiKey are required' }));
          return;
        }

        const searchData = JSON.stringify({
          api_key: apiKey,
          query: query,
          search_depth: 'basic',
          max_results: 5
        });

        const https = require('https');
        const searchReq = https.request({
          hostname: 'api.tavily.com',
          path: '/search',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(searchData)
          }
        }, (searchRes) => {
          let searchBody = '';
          searchRes.on('data', (chunk) => { searchBody += chunk; });
          searchRes.on('end', () => {
            res.writeHead(searchRes.statusCode, { 'Content-Type': 'application/json' });
            res.end(searchBody);
          });
        });

        searchReq.on('error', (err) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Search request failed: ' + err.message }));
        });

        searchReq.write(searchData);
        searchReq.end();
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  // Serve static files
  let filePath = path.join(DIR, req.url === '/' ? 'index.html' : req.url);
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

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ======================================');
  console.log('   MyGPT Local Server (Persistent)');
  console.log('   Running at: http://localhost:' + PORT);
  console.log('   Keep this window open!');
  console.log('  ======================================');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n  Server stopped.');
  process.exit();
});
