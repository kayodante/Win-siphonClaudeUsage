## 2024-05-08 - Prototype Pollution in PreferencesService
**Vulnerability:** The `deepMerge` and `setPath` functions in `src/main/preferencesService.js` are vulnerable to prototype pollution. An attacker who controls the preferences file or sets preferences dynamically could inject properties into `Object.prototype`, which could lead to remote code execution or application malfunction.
**Learning:** Even internal configuration processing tools that merge JSON values recursively are dangerous.
**Prevention:** Explicitly filter out `__proto__`, `constructor`, and `prototype` keys during object path traversal and merging.
