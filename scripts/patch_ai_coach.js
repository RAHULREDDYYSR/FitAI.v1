import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, '..', 'src', 'App.tsx');
let content = fs.readFileSync(filePath, 'utf8');
const original = content;

// ──────────────────────────────────────────────────────────
// PATCH 1: Replace profileContext + workoutContext + systemInstruction
// ──────────────────────────────────────────────────────────
const OLD_CONTEXT = content.indexOf('    const profileContext = profile ? `');
const OLD_CONTEXT_END_MARKER = "You are FitAI. Background data for context";
let ctxEnd = content.indexOf(OLD_CONTEXT_END_MARKER, OLD_CONTEXT);
if (ctxEnd === -1) { console.error('Context marker not found'); process.exit(1); }
// Find end of the systemInstruction template literal
const SYS_END = content.indexOf('`;\r\n\r\n    try {', ctxEnd);
if (SYS_END === -1) { console.error('systemInstruction end not found'); process.exit(1); }
const SYS_END_FULL = SYS_END + '`;'.length;

const NEW_CONTEXT = `    const profileContext = profile ? \`USER PROFILE:
- Name: \${profile.name || 'Unknown'} | Age: \${profile.age || '?'} | Sex: \${profile.sex || '?'} | Height: \${profile.height ? \`\${profile.height}cm\` : '?'} | Weight: \${profile.weight ? \`\${profile.weight}kg\` : '?'}
- Short-term Goal: \${profile.shortTermGoal || profile.goal || 'Not set'}
- Long-term Goal: \${profile.longTermGoal || 'Not set'}
- Detailed Aim: \${profile.aim || 'Not set'}\` : "No profile data available.";

    // Compact last-7-workout summary for agent context
    const compactWorkoutSummary = workouts.slice(0, 7).map((w, i) => {
      const wDate = w.date?.seconds ? format(new Date(w.date.seconds * 1000), 'MMM d') : 'Unknown';
      const wid = w.id ? w.id.slice(0, 8) : \`log_\${i}\`;
      const exSummary = w.exercises.map(ex => {
        const done = ex.sets.filter(s => s.completed);
        if (!done.length) return \`\${ex.name}(no sets)\`;
        const setsStr = done.map(s => {
          const sw = safeNumber(s.weight); const sr = safeNumber(s.reps);
          return sw > 0 ? \`\${sw}kg×\${sr}\` : \`BW×\${sr}\`;
        }).join(',');
        return \`\${ex.name} \${done.length}×[\${setsStr}]\`;
      }).join(' | ');
      return \`\${i+1}. [\${wid}] \${w.name} — \${wDate}: \${exSummary}\`;
    }).join('\\n') || 'No workout history yet.';

    const exerciseListText = EXERCISES.map(e => \`\${e.id}: \${e.name}\`).join('\\n');

    const systemInstruction = \`You are FitAI — a high-performance personal fitness coach. Personalize every response using the user's profile and workout history below.

\${profileContext}

LAST 7 WORKOUTS (id | name — date | exercises sets×[weight×reps]):
\${compactWorkoutSummary}

AVAILABLE EXERCISES:
\${exerciseListText}

When planning new workouts: reference recent workouts to avoid overtraining same muscles, build on progression, and align with user's short and long-term goals.\``;

content = content.slice(0, OLD_CONTEXT) + NEW_CONTEXT + content.slice(SYS_END_FULL);
console.log('PATCH 1 applied: context building updated');

// ──────────────────────────────────────────────────────────
// PATCH 2: Add client-side intent classifier + fast routing
// ──────────────────────────────────────────────────────────
const SA_MARKER = '      const StateAnnotation = Annotation.Root({';
const saIdx = content.indexOf(SA_MARKER);
if (saIdx === -1) { console.error('StateAnnotation marker not found'); process.exit(1); }

const CLASSIFIER_AND_ROUTING = `
      // ─────────────────────────────────────────────────────
      // FAST ROUTING: Classify intent without extra LLM call
      // ─────────────────────────────────────────────────────
      type MessageIntent = 'crud' | 'search' | 'general';
      const classifyMessageIntent = (text: string): MessageIntent => {
        const t = text.toLowerCase().trim();
        if (/\\b(list|show me my|view my|delete|remove|update|edit my|my routines?|my workouts?|workout (history|logs?)|how many (routines?|workouts?)|saved workouts?|do i have|i have planned)\\b/.test(t)) return 'crud';
        if (/\\b(how (to|do i) (do|perform|execute)|what (is|are|muscles? does)|explain|benefits? of|proper form|technique|tips? for|nutrition|diet|supplement|injury|recovery|protein|calorie|macro)\\b/.test(t)) return 'search';
        return 'general';
      };
      const messageIntent = classifyMessageIntent(userMsg);

`;

content = content.slice(0, saIdx) + CLASSIFIER_AND_ROUTING + content.slice(saIdx);
console.log('PATCH 2 applied: intent classifier added');

// ──────────────────────────────────────────────────────────
// PATCH 3: Parallel tool execution in CRUD agent
// ──────────────────────────────────────────────────────────
const OLD_CRUD_LOOP = `          for (const call of response.tool_calls) {
            const t = crudTools.find((x) => x.name === call.name);
            if (t) {
              const content = await t.invoke(call, { callbacks: [] });
              loopMessages.push(new ToolMessage({
                tool_call_id: call.id,
                content: typeof content === "string" ? content : JSON.stringify(content)
              }));
            }
          }`;
const NEW_CRUD_LOOP = `          // Execute tool calls in parallel for speed
          const crudToolResults = await Promise.all(
            response.tool_calls.map(async (call: any) => {
              const t = crudTools.find((x) => x.name === call.name);
              if (!t) return null;
              const result = await t.invoke(call, { callbacks: [] });
              return new ToolMessage({
                tool_call_id: call.id,
                content: typeof result === "string" ? result : JSON.stringify(result)
              });
            })
          );
          crudToolResults.filter(Boolean).forEach((msg: any) => loopMessages.push(msg));`;

if (content.includes(OLD_CRUD_LOOP)) {
  content = content.replace(OLD_CRUD_LOOP, NEW_CRUD_LOOP);
  console.log('PATCH 3 applied: parallel CRUD tool execution');
} else {
  console.warn('PATCH 3: CRUD loop not found — skipping');
}

// ──────────────────────────────────────────────────────────
// PATCH 4: Parallel tool execution in Search agent
// ──────────────────────────────────────────────────────────
const OLD_SEARCH_LOOP = `          for (const call of response.tool_calls) {
            let toolResult: any = "";
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
const NEW_SEARCH_LOOP = `          // Execute search tool calls in parallel
          const searchToolResults = await Promise.all(
            response.tool_calls.map(async (call: any) => {
              let toolResult: any = "";
              if (call.name === "tavily_search") toolResult = await tavilySearchTool.invoke(call, { callbacks: [] });
              else if (call.name === "youtube_search") toolResult = await tavilyYouTubeTool.invoke(call, { callbacks: [] });
              if (!toolResult) return null;
              return new ToolMessage({
                tool_call_id: call.id,
                content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult)
              });
            })
          );
          searchToolResults.filter(Boolean).forEach((msg: any) => loopMessages.push(msg));`;

if (content.includes(OLD_SEARCH_LOOP)) {
  content = content.replace(OLD_SEARCH_LOOP, NEW_SEARCH_LOOP);
  console.log('PATCH 4 applied: parallel Search tool execution');
} else {
  console.warn('PATCH 4: Search loop not found — skipping');
}

// ──────────────────────────────────────────────────────────
// PATCH 5: Add intent-based routing before graph invocation
// ──────────────────────────────────────────────────────────
const OLD_GRAPH_INVOKE = `      // Run the entire graph to completion
      const result = await app.invoke({ messages: history }, { callbacks: [] });`;
const NEW_GRAPH_INVOKE = `      // ─── INTENT-BASED ROUTING (saves 1 LLM call for clear intents) ───
      if (messageIntent === 'crud') {
        setAgentStatus('crud');
        const crudResult = await crudAgent({ messages: history });
        setAgentStatus('responding');
        const synthResponse = await model.invoke([
          new SystemMessage(\`You are FitAI. CRUD agent finished. Present results in clean Markdown:
- Routines listed → table: | Name | Exercises | Count |
- Workout details → table: | Exercise | Sets | Reps | Weight |
- Create/Update/Delete → confirm with ✅ and summarize
- Search results from history → clear paragraph\`),
          ...history,
          ...crudResult.messages
        ], { callbacks: [] });
        await completeBotResponse(synthResponse.content.toString() || "Done!");
        return;
      }

      if (messageIntent === 'search') {
        setAgentStatus('search');
        const searchResult = await searchAgent({ messages: history });
        setAgentStatus('responding');
        const synthResponse = await model.invoke([
          new SystemMessage(\`You are FitAI. Present search results in a structured format:
1. Key explanation (2-3 sentences)
2. Bullet tips
3. 📚 Sources section with [Title](url) links
4. 🎬 Watch section if YouTube links found: [Title](url)\`),
          ...history,
          ...searchResult.messages
        ], { callbacks: [] });
        await completeBotResponse(synthResponse.content.toString() || "Here's what I found!");
        return;
      }

      // General/complex: use full graph
      // Run the entire graph to completion
      const result = await app.invoke({ messages: history }, { callbacks: [] });`;

if (content.includes(OLD_GRAPH_INVOKE)) {
  content = content.replace(OLD_GRAPH_INVOKE, NEW_GRAPH_INVOKE);
  console.log('PATCH 5 applied: intent-based routing added');
} else {
  console.warn('PATCH 5: graph invoke marker not found — skipping');
}

// ──────────────────────────────────────────────────────────
// Write result
// ──────────────────────────────────────────────────────────
if (content !== original) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('\n✅ All patches applied. File saved.');
} else {
  console.error('\n❌ No changes made — check markers above.');
}
