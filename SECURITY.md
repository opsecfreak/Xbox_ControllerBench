# Security

ControllerBench runs locally. The server binds to `127.0.0.1`, serves static
files and sends nothing over the network. The page reads the controller and
keyboard through the browser and writes nothing to any device.

The `desktop-mode` branch adds a local API that starts a Windows input helper.
That API accepts only requests from the page on the same PC (local Host and
Origin, plus a custom header).

To report a security problem, use
[private vulnerability reporting](https://github.com/opsecfreak/Xbox_ControllerBench/security/advisories/new)
on GitHub. Do not open a public issue for it.
