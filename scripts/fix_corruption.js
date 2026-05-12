import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, '..', 'src', 'App.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// ── Step 1: Find and fix the corrupted marker ────────────────────────────────
const CORRUPT_MARKER = /\u0000*[\u0000-\u0008\u000b\u000c\u000e-\u001f\u0080-\u009f]+[^\r\n]*/g;
const hasCorruption = CORRUPT_MARKER.test(content);
if (hasCorruption) {
  console.log('Found corruption markers in file');
} else {
  console.log('No binary corruption found - looking for logical gaps...');
}

// ── Step 2: Find the broken section boundaries ───────────────────────────────
const BEFORE_ANCHOR = '        return "__end__";\r\n      };\r\n\r\n';
const AFTER_ANCHOR_1 = '      // 8. HISTORY';
const AFTER_ANCHOR_2 = '      // ─────────────────────────────────────────────────────\r\n      // 8. HISTORY';

let beforeIdx = content.indexOf(BEFORE_ANCHOR);
if (beforeIdx === -1) {
  console.error('BEFORE_ANCHOR not found');
  process.exit(1);
}
beforeIdx += BEFORE_ANCHOR.length;

let afterIdx = content.indexOf(AFTER_ANCHOR_1, beforeIdx);
if (afterIdx === -1) {
  afterIdx = content.indexOf(AFTER_ANCHOR_2, beforeIdx);
}
if (afterIdx === -1) {
  console.error('AFTER_ANCHOR not found');
  process.exit(1);
}

console.log(`Replacing chars ${beforeIdx} to ${afterIdx}`);
console.log('Removed snippet:', JSON.stringify(content.slice(beforeIdx, Math.min(beforeIdx + 200, afterIdx))));

// ── Step 3: Insert the correct code block ────────────────────────────────────
const REPLACEMENT = `
      // ─────────────────────────────────────────────────────
      // 6. BUILD & COMPILE GRAPH (used for general/fallback path)
      // ─────────────────────────────────────────────────────
      const workflow = new StateGraph(StateAnnotation)
        .addNode("superior", superiorAgent)
        .addNode("crud", crudAgent)
        .addNode("search", searchAgent)
        .addEdge("__start__", "superior")
        .addConditionalEdges("superior", routeFromSuperior)
        .addEdge("crud", "superior")
        .addEdge("search", "superior");

      const app = workflow.compile();

      // ─────────────────────────────────────────────────────
      // 8. HISTORY — last 10 turns for in-conversation memory
      // ─────────────────────────────────────────────────────
      const history = [
        new SystemMessage(systemInstruction),
        ...messages.slice(-10).map((m) =>
          m.role === 'bot' ? new AIMessage(m.text) : new HumanMessage(m.text)
        ),
        new HumanMessage(userMsg)
      ];

      // ─────────────────────────────────────────────────────
      // 9. INVOKE: Fast routing or full graph
      // ─────────────────────────────────────────────────────
      let finalContent = "";

      // Show thinking indicator
      setMessages((prev) => [
        ...prev,
        { role: 'bot', text: '...', timestamp: new Date(startTime) },
      ]);

      // FAST PATH: crud messages → skip Superior routing, call CRUD agent directly
      if (messageIntent === 'crud') {
        setAgentStatus('crud');
        const crudResult = await crudAgent({ messages: history });
        setAgentStatus('responding');
        const synthResp = await model.invoke([
          new SystemMessage(\`You are FitAI. The CRUD agent completed. Present results in clean Markdown:
- Routines listed → table: | Name | Description | Exercise Count |
- Workout logs → table: | Exercise | Sets | Reps | Weight |
- Create/Update/Delete → confirm with a checkmark and summarize the change
- If nothing found, say so clearly. No clarifying questions.\`),
          ...history,
          ...crudResult.messages
        ], { callbacks: [] });
        await completeBotResponse(synthResp.content.toString() || "Done!");
        return;
      }

      // FAST PATH: search messages → skip Superior routing, call Search agent directly
      if (messageIntent === 'search') {
        setAgentStatus('search');
        const searchResult = await searchAgent({ messages: history });
        setAgentStatus('responding');
        const synthResp = await model.invoke([
          new SystemMessage(\`You are FitAI. Present search results in structured Markdown:
1. Key explanation (2-3 sentences)
2. Bullet tips/steps
3. Sources section: [Title](url) links
4. Watch section (only if YouTube links found): [Title](url)\`),
          ...history,
          ...searchResult.messages
        ], { callbacks: [] });
        await completeBotResponse(synthResp.content.toString() || "Here's what I found!");
        return;
      }

      // GENERAL / COMPLEX: use full LangGraph (Superior routes → sub-agent → Superior synthesises)
      const result = await app.invoke({ messages: history }, { callbacks: [] });

      // Extract final response — walk in reverse, skip delegation signals
      const allResultMessages = result?.messages || [];
      if (deferredRoutinePlan) {
        setPendingRoutinePlan({
          conversationId: convId,
          originalRequest: userMsg,
          routine: deferredRoutinePlan
        });
        finalContent = formatRoutineForApproval(deferredRoutinePlan);
      } else {
        for (let i = allResultMessages.length - 1; i >= 0; i--) {
          const m = allResultMessages[i];
          const msgType = m._getType?.() || m.role || m.constructor?.name;
          const isAI = msgType === "ai" || msgType === "assistant" || msgType === "AIMessage";
          if (isAI && !m.tool_calls?.length) {
            const text = m.content?.toString() || "";
            if (!text.includes("DELEGATE_TO_") && text.trim().length > 0) {
              finalContent = text;
              break;
            }
          }
        }
      }

`;

content = content.slice(0, beforeIdx) + REPLACEMENT + content.slice(afterIdx);

// ── Step 4: Remove any lingering corrupted bytes ─────────────────────────────
content = content.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

// ── Step 5: Fix parallel tool execution in CRUD agent ────────────────────────
const OLD_CRUD = `          for (const call of response.tool_calls) {
            const t = crudTools.find((x) => x.name === call.name);
            if (t) {
              const content = await t.invoke(call, { callbacks: [] });
              loopMessages.push(new ToolMessage({
                tool_call_id: call.id,
                content: typeof content === "string" ? content : JSON.stringify(content)
              }));
            }
          }`;
const NEW_CRUD = `          const crudToolResults = await Promise.all(
            response.tool_calls.map(async (call) => {
              const t = crudTools.find((x) => x.name === call.name);
              if (!t) return null;
              const result = await t.invoke(call, { callbacks: [] });
              return new ToolMessage({
                tool_call_id: call.id,
                content: typeof result === "string" ? result : JSON.stringify(result)
              });
            })
          );
          crudToolResults.filter(Boolean).forEach((msg) => loopMessages.push(msg));`;

if (content.includes(OLD_CRUD)) {
  content = content.replace(OLD_CRUD, NEW_CRUD);
  console.log('Parallel CRUD tools applied');
} else {
  console.warn('Parallel CRUD pattern not found - skipping');
}

// ── Step 6: Fix parallel tool execution in Search agent ──────────────────────
const OLD_SEARCH = `          for (const call of response.tool_calls) {
            let toolResult = "";
            if (call.name === "tavily_search") {
              toolResult = await tavilySearchTool.invoke(call, { callbacks: [] });
            } else if (call.name === "youtube_search") {
              toolResult = await tavilyYouTubeTool.invoke(call, { callbacks: [] });
            }
            if (toolResult) {
              loopMessages.push(new ToolMessage({
                tool_call_id: call.id,
                content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult)
              }));
            }
          }`;
const NEW_SEARCH = `          const searchToolResults = await Promise.all(
            response.tool_calls.map(async (call) => {
              let toolResult = "";
              if (call.name === "tavily_search") toolResult = await tavilySearchTool.invoke(call, { callbacks: [] });
              else if (call.name === "youtube_search") toolResult = await tavilyYouTubeTool.invoke(call, { callbacks: [] });
              if (!toolResult) return null;
              return new ToolMessage({
                tool_call_id: call.id,
                content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult)
              });
            })
          );
          searchToolResults.filter(Boolean).forEach((msg) => loopMessages.push(msg));`;

if (content.includes(OLD_SEARCH)) {
  content = content.replace(OLD_SEARCH, NEW_SEARCH);
  console.log('Parallel Search tools applied');
} else {
  console.warn('Parallel Search pattern not found - skipping');
}

// ── Write ─────────────────────────────────────────────────────────────────────
fs.writeFileSync(filePath, content, 'utf8');
console.log('\nDone. File saved. Lines:', content.split('\n').length);
