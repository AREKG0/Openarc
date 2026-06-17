# Contributing to Openarc

First off, thank you for considering contributing to Openarc! It's people like you that make open source such a great community.

## Where do I go from here?

If you've noticed a bug or have a feature request, make sure to check our [Issues](../../issues) first. If it doesn't exist, go ahead and create one!

## Fork & create a branch

If this is something you think you can fix, then fork Openarc and create a branch with a descriptive name.

A good branch name would be (where issue #325 is the ticket you're working on):

```sh
git checkout -b 325-add-dark-mode-toggle
```

## Local Development

1. Ensure you have Node.js and Ollama installed.
2. Clone your fork locally.
3. Start the application:
   - **Windows:** Run `scripts\launch.bat`
   - **Manual:** Run `node server.js`
4. Make your changes in the `public/` directory (for frontend) or `server.js` (for backend proxy).

## Commit your changes

We use conventional commits. Please try to follow this format:

- `feat:` for a new feature
- `fix:` for a bug fix
- `docs:` for documentation changes
- `style:` for formatting, missing semi colons, etc
- `refactor:` for refactoring production code
- `test:` for adding tests
- `chore:` for updating build tasks, package manager configs, etc

## Pull Request Process

1. Ensure any install or build dependencies are removed before the end of the layer when doing a build.
2. Update the README.md with details of changes to the interface, this includes new environment variables, exposed ports, useful file locations and container parameters.
3. You may merge the Pull Request in once you have the sign-off of two other developers, or if you do not have permission to do that, you may request the second reviewer to merge it for you.
