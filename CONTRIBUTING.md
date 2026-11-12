# Contributing

Thanks for helping. Bug reports, device reports and pull requests are welcome.

## Report a bug

1. Reproduce the problem.
2. Open the **Diagnostics** tab. Press **Copy errors**.
3. Press **Export report**.
4. Open a [bug report](https://github.com/opsecfreak/Xbox_ControllerBench/issues/new?template=bug_report.md).
   Paste the errors and attach the report JSON.

## Report a device

Tested a controller, chatpad or keyboard that is not in the compatibility
table? Open a
[compatibility report](https://github.com/opsecfreak/Xbox_ControllerBench/issues/new?template=compatibility_report.md)
with the report JSON. Reports for Bluetooth, Series X|S, Elite, PlayStation
and Switch controllers help most.

## Change the code

1. Fork the repo and create a branch.
2. Read [AGENTS.md](AGENTS.md): code map and hard rules.
3. Make the change. Put pure logic in `public/js/lib/` and add a test in `test/`.
4. Run the tests:

   ```bash
   npm test
   ```

5. Run the page and check the change in Chrome:

   ```bash
   npm start
   ```

6. Add a line to `CHANGELOG.md` under a new version heading.
7. Open a pull request. Say what you tested and on which device.

Rules that keep the project safe and simple:
- No firmware writes, no WebUSB, WebHID or WebSerial access to devices.
- No dependencies and no build step unless there is no other way.
- No invented specs. Thresholds are user settings and are labeled as such.
- No secrets or personal data in code, docs or test files.

By contributing you agree that your contribution is licensed under the
[MIT License](LICENSE).
