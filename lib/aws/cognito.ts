import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  GlobalSignOutCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import crypto from "crypto";

const client = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION!,
});

/** Computes the SECRET_HASH if the app client has a client secret configured. */
function computeSecretHash(username: string): string | undefined {
  const clientSecret = process.env.AWS_COGNITO_CLIENT_SECRET;
  if (!clientSecret) return undefined;
  return crypto
    .createHmac("SHA256", clientSecret)
    .update(username + process.env.AWS_COGNITO_CLIENT_ID!)
    .digest("base64");
}

/**
 * Authenticates a Cognito user with username/password (USER_PASSWORD_AUTH flow).
 * Returns the AuthenticationResult tokens or throws on failure.
 */
export async function cognitoSignIn(username: string, password: string) {
  const secretHash = computeSecretHash(username);

  const command = new InitiateAuthCommand({
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: process.env.AWS_COGNITO_CLIENT_ID!,
    AuthParameters: {
      USERNAME: username,
      PASSWORD: password,
      ...(secretHash ? { SECRET_HASH: secretHash } : {}),
    },
  });

  const response = await client.send(command);
  return response.AuthenticationResult;
}

/**
 * Globally signs out the user by invalidating all tokens for the given access token.
 */
export async function cognitoSignOut(accessToken: string): Promise<void> {
  const command = new GlobalSignOutCommand({ AccessToken: accessToken });
  await client.send(command);
}
