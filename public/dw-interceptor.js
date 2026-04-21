// This script runs in the PAGE context (world: "MAIN"), not the extension context.
// It intercepts DegreeWorks' own fetch calls to capture the worksheet JSON
// before it gets rendered into the DOM.

(function () {
  if (window.__fordhamHelperInjected) return;
  window.__fordhamHelperInjected = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (...args) {
    const response = await originalFetch(...args);
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url ?? "";

    // DegreeWorks API endpoints we care about:
    // - /api/worksheets/...
    // - /responsiveDashboard/api/audit
    // - /api/audit
    // - anything containing "worksheet" or "audit"
    const isAuditEndpoint =
      /worksheet|audit|degree.*works/i.test(url) &&
      !url.includes(".js") &&
      !url.includes(".css");

    if (isAuditEndpoint) {
      const clone = response.clone();
      clone
        .json()
        .then((data) => {
          window.postMessage(
            { type: "FORDHAM_HELPER_AUDIT_JSON", data, url },
            "*"
          );
        })
        .catch(() => {
          // Not JSON — ignore
        });
    }

    return response;
  };

  // Also intercept XHR for older DegreeWorks versions
  const OriginalXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OriginalXHR();
    const originalOpen = xhr.open.bind(xhr);
    let capturedUrl = "";

    xhr.open = function (method, url, ...rest) {
      capturedUrl = url?.toString() ?? "";
      return originalOpen(method, url, ...rest);
    };

    xhr.addEventListener("load", function () {
      if (
        /worksheet|audit/i.test(capturedUrl) &&
        !capturedUrl.includes(".js")
      ) {
        try {
          const data = JSON.parse(xhr.responseText);
          window.postMessage(
            { type: "FORDHAM_HELPER_AUDIT_JSON", data, url: capturedUrl },
            "*"
          );
        } catch {
          // Not JSON — ignore
        }
      }
    });

    return xhr;
  }
  PatchedXHR.prototype = OriginalXHR.prototype;
  window.XMLHttpRequest = PatchedXHR as any;
})();
