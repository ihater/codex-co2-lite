# Contributing

For a bug report, include the Co² build, Codex Desktop and OS versions, and steps to reproduce with synthetic data. Report vulnerabilities through the [private reporting channel](SECURITY.md).

## Run the tests

Use the Node.js version in `.node-version`. From the repository root, run the following commands.

```sh
npm ci --ignore-scripts
npm run lite:test
npm run check:public
npm run notices:check
npm run test:licenses
```

Changes to the retained upstream transport or Desktop integration should also run the full synthetic suite:

```sh
npm test
```

After changing dependencies, regenerate the notices with `npm run notices:write`, review the changes and rerun `npm run notices:check`.

## Submit a pull request

Describe what changes for the user, which tests you ran and any remaining limitations. Use synthetic data in logs and screenshots. Submit only work you can license under the project's [MIT license](LICENSE).
