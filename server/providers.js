// Connector capabilities, never provider-specific game rules. Remote labels are
// client declarations; the server cannot attest which model actually generated a move.
export const PROVIDERS = {
  codex: {id:'codex',name:'Codex CLI',remote:true,modelSelection:true,models:null},
};
