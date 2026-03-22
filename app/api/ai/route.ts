import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { invokeBedrockAgent } from "@/lib/aws/bedrock";
import { z } from "zod";

/* ------------------------------------------------------------------ */
/*  Request validation                                                 */
/* ------------------------------------------------------------------ */

const RequestSchema = z.object({
  message: z.string().min(1).max(10_000),
  sessionId: z.string().min(1).max(200),
  files: z
    .array(
      z.object({
        name: z.string(),
        mediaType: z.string(),
        base64: z.string(),
      }),
    )
    .max(5)
    .optional(),
});

/* ------------------------------------------------------------------ */
/*  POST /api/ai — Streaming SSE endpoint                             */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  /* --- Auth check --- */
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /* --- Parse & validate body --- */
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { message, sessionId, files } = parsed.data;

  /* --- Streaming response via SSE --- */
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      }

      try {
        const response = await invokeBedrockAgent({
          message,
          sessionId,
          idToken: session.idToken,
          files,
        });

        if (!response.completion) {
          sendEvent("error", { message: "No completion stream returned" });
          controller.close();
          return;
        }

        for await (const event of response.completion) {
          if (event.chunk) {
            const text = new TextDecoder().decode(event.chunk.bytes);
            sendEvent("chunk", { text });
          }

          if (event.returnControl) {
            sendEvent("returnControl", {
              invocationId: event.returnControl.invocationId,
              invocationInputs: event.returnControl.invocationInputs,
            });
          }

          if (event.trace?.trace) {
            const t = event.trace.trace;

            // Orchestration trace — rationale (agent thinking / reasoning)
            if (t.orchestrationTrace?.rationale?.text) {
              sendEvent("thinking", {
                type: "rationale",
                text: t.orchestrationTrace.rationale.text,
              });
            }

            // Orchestration trace — model invocation input (prompt sent to LLM)
            if (t.orchestrationTrace?.modelInvocationInput?.text) {
              sendEvent("thinking", {
                type: "modelInput",
                text: t.orchestrationTrace.modelInvocationInput.text,
              });
            }

            // Orchestration trace — invocation input (tool call)
            if (t.orchestrationTrace?.invocationInput) {
              const inv = t.orchestrationTrace.invocationInput;
              sendEvent("thinking", {
                type: "toolCall",
                actionGroup: inv.actionGroupInvocationInput?.actionGroupName,
                apiPath: inv.actionGroupInvocationInput?.apiPath,
                function: inv.actionGroupInvocationInput?.function,
                knowledgeBase: inv.knowledgeBaseLookupInput?.knowledgeBaseId,
                query: inv.knowledgeBaseLookupInput?.text,
                invocationType: inv.invocationType,
              });
            }

            // Orchestration trace — observation (tool result)
            if (t.orchestrationTrace?.observation) {
              const obs = t.orchestrationTrace.observation;
              const output =
                obs.actionGroupInvocationOutput?.text ??
                obs.knowledgeBaseLookupOutput?.retrievedReferences
                  ?.map((r) => r.content?.text)
                  .filter(Boolean)
                  .join("\n")
                  .slice(0, 500) ??
                obs.finalResponse?.text;
              if (output) {
                sendEvent("thinking", {
                  type: "observation",
                  text: output,
                  traceType: obs.type,
                });
              }
            }

            // Pre/Post processing traces
            if (t.preProcessingTrace?.modelInvocationOutput?.parsedResponse) {
              sendEvent("thinking", {
                type: "preProcessing",
                isValid: t.preProcessingTrace.modelInvocationOutput.parsedResponse.isValid,
                rationale: t.preProcessingTrace.modelInvocationOutput.parsedResponse.rationale,
              });
            }

            if (t.postProcessingTrace?.modelInvocationOutput?.parsedResponse?.text) {
              sendEvent("thinking", {
                type: "postProcessing",
                text: t.postProcessingTrace.modelInvocationOutput.parsedResponse.text,
              });
            }

            // Failure trace
            if (t.failureTrace?.failureReason) {
              sendEvent("thinking", {
                type: "failure",
                text: t.failureTrace.failureReason,
              });
            }
          }
        }

        sendEvent("done", {});
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        console.error("[api/ai] Bedrock agent error:", errorMessage);
        sendEvent("error", { message: errorMessage });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
