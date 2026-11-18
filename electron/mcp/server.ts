import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { callLocalBridge } from './bridge';
import { MCP_INSTRUCTIONS, toolDescriptions, toolSchemas, type ToolName } from './contracts';

export async function startMcpServer() {
  const server = new McpServer({ name: 'sourcefield', version: '1.1.0' }, { instructions: MCP_INSTRUCTIONS });
  for (const name of Object.keys(toolSchemas) as ToolName[]) {
    server.registerTool(`sourcefield_${name}`, { description: toolDescriptions[name], inputSchema: toolSchemas[name],
      annotations: { readOnlyHint: name !== 'control_view', destructiveHint: false, idempotentHint: name !== 'control_view', openWorldHint: false } },
      async (args: unknown) => {
        try {
          const result = await callLocalBridge(name, args);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
        } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Sourcefield request failed.' }] }; }
      });
  }
  await server.connect(new StdioServerTransport());
  const stop = () => { server.close().finally(() => process.exit(0)); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return server;
}
if (require.main === module) startMcpServer().catch(error => { console.error(`Sourcefield MCP: ${error instanceof Error ? error.message : 'Startup failed.'}`); process.exitCode = 1; });
