/* Synapse runtime config. Loaded FIRST on every page (before js/i18n.js).
   backend: "auto" = probe GET /api/me once per page load (a 404 / non-JSON / network
            error means a static host such as GitHub Pages -> browse-only mode);
            "off"  = never talk to a backend (browse-only, zero requests);
            "on"   = always assume the Synapse server is there.
   Any *.github.io host is always treated as static. */
window.SYNAPSE_CONFIG = window.SYNAPSE_CONFIG || { backend: "auto" };
