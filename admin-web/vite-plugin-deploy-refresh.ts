import type { Plugin } from "vite"
import { execSync } from "node:child_process"

const DEPLOY_REFRESH_SCRIPT = `
(function () {
  var meta = document.querySelector('meta[name="yhgc-deploy-id"]');
  if (!meta) return;
  var buildId = meta.getAttribute("content");
  if (!buildId) return;
  var storageKey = "yhgc-admin-deploy-id-v2";
  var reloadKey = "yhgc-admin-deploy-reload-v2";
  var seen = localStorage.getItem(storageKey);
  if (seen === buildId) return;
  localStorage.setItem(storageKey, buildId);
  if (sessionStorage.getItem(reloadKey) === buildId) return;
  sessionStorage.setItem(reloadKey, buildId);
  var url = new URL(window.location.href);
  url.searchParams.set("_yhgc_deploy", buildId);
  window.location.replace(url.toString());
})();
`.trim()

function createDeployId(): string {
  let git = "unknown"
  try {
    git = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim()
  } catch {
    // non-git environment
  }
  return `${git}-${Date.now().toString(36)}`
}

/** Injects a per-build id + one-time hard navigation when a new deploy is detected. */
export function deployRefreshPlugin(): Plugin {
  let deployId = ""
  return {
    name: "yhgc-deploy-refresh",
    config() {
      deployId = createDeployId()
      return {
        define: {
          __YHGC_DEPLOY_ID__: JSON.stringify(deployId),
        },
      }
    },
    transformIndexHtml(html) {
      const id = deployId || createDeployId()
      const inject = [
        `<meta name="yhgc-deploy-id" content="${id}" />`,
        `<script>${DEPLOY_REFRESH_SCRIPT}</script>`,
      ].join("\n    ")
      return html.replace("</head>", `    ${inject}\n  </head>`)
    },
  }
}
