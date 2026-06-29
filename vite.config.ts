import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// SharedArrayBuffer requires the page to be cross-origin isolated, which in
// turn requires these two response headers (COOP + COEP). They are set on the
// dev server and the preview server here; the production host must send the
// same headers (see DesignDocs/DESIGN.md "Constraints and gotchas").
const crossOriginIsolation = {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
	plugins: [react()],
	server: {
		headers: crossOriginIsolation,
	},
	preview: {
		headers: crossOriginIsolation,
	},
	worker: {
		format: "es",
	},
});
