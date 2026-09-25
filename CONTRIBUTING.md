# Contributing

Issues and pull requests are welcome. Keep changes scoped, source every data or methodology change, and preserve explicit null/unavailable states instead of substituting estimates.

1. Use Node.js 22 or newer and install the locked dependency tree with `npm ci`.
2. Create a focused branch and update tests or documentation with behavior changes.
3. Run `npm run check`, `npm test`, and `npm run build`.
4. Confirm that generated snapshots contain only public, source-backed observations and no credentials, private data, local paths, or internal deployment details.
5. Explain changed metric definitions, source provenance, and known limitations in the pull request.

Do not commit `.env`, `state/`, local archives, dependency directories, build output, credentials, or private endpoints. By contributing, you agree that your contribution is licensed under the MIT License.
