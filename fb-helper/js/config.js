// Constants that more than one layer needs (state.js, graph.js, cookies.js). They live in a leaf module so none of
// those has to import another one just to read a value.

// Graph API version: v26.0 is the newest on 2026-09-28 (released 2026-07-29). Marketing API versions (ad
// accounts, ads, insights) stop working ~90 days after the next release. Graph then either auto-upgrades the
// call and names the new version in X-Ad-Api-Version-Warning, or fails with #2635 "…update to the latest
// version: vNN.0". Either way the newer version is remembered (adoptVersion), so the extension keeps working
// without a release. Still bump this constant when you ship an update.
export const API_VERSION = "v26.0";

// The Graph host is named in exactly one place, the entry (popup.js: GRAPH_URL), and handed down from there with
// setGraphUrl before anything runs: one line to audit for "where does this extension send requests". Every request goes
// there, and it is also the URL whose cookies are read (exactly the ones Chrome would send along). Modules read it at
// call time, never while they are evaluated.
let graphUrl = "";
export const setGraphUrl = (url) => { graphUrl = url; };
export const getGraphUrl = () => graphUrl;
