import { useEffect, useState } from 'react';
import { Check, Copy, Plug, X } from 'lucide-react';
import type { McpConfiguration } from '../../shared/types';

export function McpSetup({ onClose }: { onClose: () => void }) {
  const [configuration, setConfiguration] = useState<McpConfiguration | null>(null);
  const [client, setClient] = useState<'claude' | 'codex'>('claude');
  const [copied, setCopied] = useState(false), [error, setError] = useState('');
  useEffect(() => { window.sourcefield?.getMcpConfiguration().then(setConfiguration).catch(() => setError('Open the desktop app to view its local connection settings.')); }, []);
  async function copy() {
    try { await window.sourcefield?.copyMcpConfiguration(client); setCopied(true); }
    catch { setError('Select the configuration text and copy it with your keyboard.'); }
  }
  return <div className="modal-backdrop" onClick={onClose}><section className="help-modal mcp-modal" role="dialog" aria-modal="true" aria-labelledby="mcp-title" onClick={e => e.stopPropagation()}>
    <button className="icon-button modal-close" onClick={onClose} aria-label="Close MCP setup"><X size={17} /></button>
    <Plug size={25} strokeWidth={1.4} /><h2 id="mcp-title">Connect your AI</h2>
    <p>Let your desktop AI client search this project, read relevant code, and control its map. Sourcefield must stay open.</p>
    <p className="small">{configuration?.running ? 'Local connection ready. No hosting or public URL.' : 'The local connection is unavailable. Restart Sourcefield to retry.'}</p>
    <div className="mcp-client-tabs"><button className={client === 'claude' ? 'active' : ''} onClick={() => { setClient('claude'); setCopied(false); }}>Claude Desktop</button><button className={client === 'codex' ? 'active' : ''} onClick={() => { setClient('codex'); setCopied(false); }}>ChatGPT / Codex</button></div>
    <p className="small">{client === 'claude' ? 'Merge this into Claude Desktop’s developer configuration, then restart Claude.' : 'Add this to your local ~/.codex/config.toml, or use the command and args in ChatGPT desktop’s MCP server settings. Restart the client.'}</p>
    <textarea className="mcp-config" readOnly spellCheck={false} aria-label="MCP connection configuration" value={configuration?.[client] ?? ''} onFocus={e => e.currentTarget.select()} />
    <button className="button subtle mcp-copy" onClick={copy} disabled={!configuration}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy configuration'}</button>
    <p className="small">Requires Node.js 22.12+. If your AI client cannot find <code>node</code>, replace it with the absolute path to your Node executable. Both clients use the same server.</p>
    {error && <p role="alert" className="small">{error}</p>}
  </section></div>;
}
