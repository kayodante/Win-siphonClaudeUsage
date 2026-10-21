Title: 🧹 Remove leftover console.log from renderer bootstrap

Description:
* 🎯 **What:** Removed leftover aesthetic `console.log` statements from the renderer initialization logic in `src/renderer/renderer.js` that printed Siphon banner text and github repository url.
* 💡 **Why:** `console.log` statements in production renderer code are not necessary and can clutter the developer console. Removing them improves code cleanliness and readability.
* ✅ **Verification:** Ran `npm run lint` and `npm test` successfully. Verified that no functionality was altered as these logs were purely informational developer outputs.
* ✨ **Result:** Cleaner renderer file free of leftover debugging/informational print statements.
