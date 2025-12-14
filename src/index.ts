import { Elysia, t } from "elysia";
import { SessionManager } from "./service/session-manager";

const sessionManager = new SessionManager(1); // use 1 for testing

const app = new Elysia()
    .post(
        "/exec",
        async ({ body, query }) => {
            const { code, files = [] } = body;
            const { sessionId } = query;

            if (!sessionId) {
                return {
                    success: false,
                    error: {
                        type: "validation",
                        message: "sessionId query parameter is required",
                    },
                };
            }

            try {
                // Get or create session
                const session = await sessionManager.getOrCreateSession(
                    sessionId as string,
                );
                const environment = session.environment;

                // Execute the code
                const result = await environment.runCode(code, files);

                return {
                    success: true,
                    result,
                };
            } catch (error: any) {
                return {
                    success: false,
                    error: {
                        type: "execution",
                        message: error.message || "Unknown error occurred",
                    },
                };
            }
        },
        {
            body: t.Object({
                code: t.String(),
                files: t.Optional(
                    t.Array(
                        t.Object({
                            filename: t.String(),
                            b64_data: t.String(),
                        }),
                    ),
                ),
            }),
            query: t.Object({
                sessionId: t.String(),
            }),
        },
    )
    .get("/health", () => ({
        status: "healthy",
        activeSessions: sessionManager.getActiveSessionCount(),
    }))
    .get("/sessions", () => ({
        sessions: sessionManager.getSessionsInfo(),
    }))
    .listen(3080);

console.log(
    `vivarium is running at ${app.server?.hostname}:${app.server?.port}`,
);
