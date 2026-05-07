import { Router, Request, Response } from "express";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { StateGraph, Annotation } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const router = Router();

// Helper: create a configured ChatOpenAI model
function createModel() {
  return new ChatOpenAI({
    modelName: "gpt-5.4-mini",
    openAIApiKey: process.env.OPENAI_API_KEY,
  });
}

// ─── POST /api/ai/chat ───────────────────────────────────────────────────────
// Main AI Coach chatbot endpoint (LangGraph agent with tools)
router.post("/chat", async (req: Request, res: Response) => {
  try {
    const {
      messages,         // ChatMessage[] from frontend
      systemInstruction,
      routines,         // Routine[] for tool context
    } = req.body;

    if (!messages || !systemInstruction) {
      return res.status(400).json({ error: "messages and systemInstruction are required" });
    }

    const model = createModel();

    // ── Define Tools ──
    // The tools don't actually mutate anything server-side.
    // They return structured output that the frontend uses to perform Firestore writes.
    const createRoutineTool = tool(async (args) => {
      return JSON.stringify({ action: "create_routine", data: args });
    }, {
      name: "create_routine",
      description: "Create a new workout routine for the user",
      schema: z.object({
        name: z.string().describe("Name of the routine (e.g. 'Push Day')"),
        exercises: z.array(z.object({
          name: z.string(),
          sets: z.array(z.object({
            weight: z.number(),
            reps: z.number()
          }))
        }))
      })
    });

    const updateRoutineTool = tool(async (args) => {
      return JSON.stringify({ action: "update_routine", data: args });
    }, {
      name: "update_routine",
      description: "Update an existing workout routine",
      schema: z.object({
        id: z.string().describe("The ID of the routine to update"),
        name: z.string().optional(),
        exercises: z.array(z.object({
          name: z.string(),
          sets: z.array(z.object({
            weight: z.number(),
            reps: z.number()
          }))
        })).optional()
      })
    });

    const deleteRoutineTool = tool(async (args) => {
      return JSON.stringify({ action: "delete_routine", data: args });
    }, {
      name: "delete_routine",
      description: "Delete an existing workout routine",
      schema: z.object({
        id: z.string().describe("The ID of the routine to delete")
      })
    });

    const updateProfileTool = tool(async (args) => {
      return JSON.stringify({ action: "update_profile", data: args });
    }, {
      name: "update_profile",
      description: "Updates user's fitness profile information (name, goal, weight, age, sex, aim etc.)",
      schema: z.object({
        displayName: z.string().optional(),
        goal: z.string().optional(),
        aim: z.string().optional(),
        weight: z.number().optional(),
        age: z.number().optional(),
        sex: z.enum(["male", "female", "other"]).optional(),
        level: z.enum(["beginner", "intermediate", "advanced"]).optional(),
        equipment: z.array(z.string()).optional()
      })
    });

    const tools = [createRoutineTool, updateRoutineTool, deleteRoutineTool, updateProfileTool];
    const modelWithTools = model.bindTools(tools);

    // ── LangGraph Workflow ──
    const StateAnnotation = Annotation.Root({
      messages: Annotation<any[]>({
        reducer: (x, y) => x.concat(y),
      }),
    });

    // Collect tool actions to return to the frontend
    const toolActions: any[] = [];

    const callModel = async (state: typeof StateAnnotation.State) => {
      const response = await modelWithTools.invoke(state.messages);
      return { messages: [response] };
    };

    const toolNode = async (state: typeof StateAnnotation.State) => {
      const lastMessage = state.messages[state.messages.length - 1];
      const results: ToolMessage[] = [];

      if (lastMessage.tool_calls?.length) {
        for (const call of lastMessage.tool_calls) {
          const toolToCall = tools.find(t => t.name === call.name);
          if (toolToCall) {
            const output = await toolToCall.invoke(call);
            results.push(output);

            // Parse the tool output and collect actions for the frontend
            try {
              const parsed = JSON.parse(typeof output === 'string' ? output : output.content);
              toolActions.push(parsed);
            } catch {
              // Tool output wasn't JSON, ignore
            }
          }
        }
      }
      return { messages: results };
    };

    const workflow = new StateGraph(StateAnnotation)
      .addNode("agent", callModel)
      .addNode("tools", toolNode)
      .addEdge("__start__", "agent")
      .addConditionalEdges("agent", (state) => {
        const lastMessage = state.messages[state.messages.length - 1];
        if (lastMessage.tool_calls?.length) return "tools";
        return "__end__";
      })
      .addEdge("tools", "agent");

    const app = workflow.compile();

    // ── Build LangChain message history ──
    const langChainHistory = [
      new SystemMessage(systemInstruction),
      ...messages.map((m: { role: string; text: string }) =>
        m.role === 'bot' ? new AIMessage(m.text) : new HumanMessage(m.text)
      ),
    ];

    // ── Execute with LangSmith tracing (automatic via env vars) ──
    const result = await app.invoke(
      { messages: langChainHistory },
      {
        // LangSmith tracing is automatic when LANGCHAIN_TRACING_V2=true
        // is set in the server's process.env — no manual tracer needed!
      }
    );

    const finalMessage = result.messages[result.messages.length - 1];
    const botText = finalMessage.content?.toString() || "Action complete.";

    return res.json({
      response: botText,
      toolActions: toolActions,
    });
  } catch (error: any) {
    console.error("AI Chat Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error during AI chat",
    });
  }
});

// ─── POST /api/ai/refine-goal ────────────────────────────────────────────────
// Refine a user's fitness goal using AI
router.post("/refine-goal", async (req: Request, res: Response) => {
  try {
    const { aim, currentGoal } = req.body;

    if (!aim) {
      return res.status(400).json({ error: "aim is required" });
    }

    const model = createModel();

    const prompt = `Act as an expert fitness strategist. Refine the following user's fitness vision and aim into a professional, high-impact, and motivating primary goal.
                   
    User's vision and aim: "${aim}"
    Current Goal: "${currentGoal || 'None'}"
    
    Rules:
    - Keep it under 10 words
    - Use powerful, athletic language
    - Direct alignment with their motivation
    
    Refined Primary Goal:`;

    const response = await model.invoke(prompt);
    const refined = response.content.toString() || "";

    return res.json({
      refinedGoal: refined.trim().replace(/^"|"$/g, ''),
    });
  } catch (error: any) {
    console.error("Goal Refinement Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error during goal refinement",
    });
  }
});

// ─── POST /api/ai/summarize ──────────────────────────────────────────────────
// Summarize conversation history into a neural memory
router.post("/summarize", async (req: Request, res: Response) => {
  try {
    const { messages, existingSummary } = req.body;

    if (!messages) {
      return res.status(400).json({ error: "messages are required" });
    }

    const model = createModel();

    const promptText = `Analyze the following chat history and update the "Neural Memory".
       
Existing Memory (Chat History Summary):
${existingSummary || "No previous context."}

New Messages:
${messages.map((m: { role: string; text: string }) => `${m.role.toUpperCase()}: ${m.text}`).join('\n')}

Rules:
- Synthesize key information (new goals, preferences, physical issues)
- Keep it under 200 words
- Maintain a structured, informative tone

New Neural Memory:`;

    const response = await model.invoke(promptText);
    const newSummary = (response.content.toString() || existingSummary || "").trim();

    return res.json({
      summary: newSummary,
    });
  } catch (error: any) {
    console.error("Summarization Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error during summarization",
    });
  }
});

export default router;
