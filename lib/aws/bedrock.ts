import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
  type InvokeAgentCommandOutput,
} from "@aws-sdk/client-bedrock-agent-runtime";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";

/* ------------------------------------------------------------------ */
/*  Client factory — per-request (token-bound credentials)             */
/* ------------------------------------------------------------------ */

/**
 * Creates a BedrockAgentRuntimeClient authenticated via Cognito Identity Pool.
 * Each request gets its own client because the idToken differs per user/session.
 */
function createClient(idToken: string): BedrockAgentRuntimeClient {
  const region = process.env.AWS_REGION ?? "eu-central-1";
  const identityPoolId = process.env.COGNITO_IDENTITY_POOL_ID;
  const userPoolId = process.env.AWS_COGNITO_USER_POOL_ID;

  if (!identityPoolId) {
    throw new Error("Missing COGNITO_IDENTITY_POOL_ID environment variable");
  }
  if (!userPoolId) {
    throw new Error("Missing AWS_COGNITO_USER_POOL_ID environment variable");
  }

  const providerKey = `cognito-idp.${region}.amazonaws.com/${userPoolId}`;

  return new BedrockAgentRuntimeClient({
    region,
    credentials: fromCognitoIdentityPool({
      clientConfig: { region },
      identityPoolId,
      logins: {
        [providerKey]: idToken,
      },
    }),
  });
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export interface InvokeAgentParams {
  message: string;
  sessionId: string;
  /** Cognito id_token for Identity Pool authentication */
  idToken: string;
  /** Optional files encoded as base64 with metadata */
  files?: Array<{
    name: string;
    mediaType: string;
    base64: string;
  }>;
}

/**
 * Invokes the Bedrock agent and returns the raw SDK response.
 * The caller is responsible for iterating `response.completion`.
 */
export async function invokeBedrockAgent(
  params: InvokeAgentParams,
): Promise<InvokeAgentCommandOutput> {
  const agentId = process.env.BEDROCK_AGENT_ID;
  const agentAliasId = process.env.BEDROCK_AGENT_ALIAS_ID;

  if (!agentId || !agentAliasId) {
    throw new Error(
      "Missing BEDROCK_AGENT_ID or BEDROCK_AGENT_ALIAS_ID environment variables",
    );
  }

  const command = new InvokeAgentCommand({
    agentId,
    agentAliasId,
    sessionId: params.sessionId,
    inputText: params.message,
    enableTrace: true,
    ...(params.files && params.files.length > 0
      ? {
          sessionState: {
            files: params.files.map((f) => ({
              name: f.name,
              source: {
                sourceType: "BYTE_CONTENT" as const,
                byteContent: {
                  mediaType: f.mediaType,
                  data: Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)),
                },
              },
              useCase: "CHAT" as const,
            })),
          },
        }
      : {}),
  });

  return createClient(params.idToken).send(command);
}
