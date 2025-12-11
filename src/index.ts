import { Elysia, t, sse } from "elysia";
import { setTimeout } from "timers/promises";
import { PythonEnvironment } from "./service/types";
import { PyodidePythonEnvironment } from "./service/python-interpreter";

// const pythonEnvironment: PythonEnvironment = new PyodidePythonEnvironment();
// pythonEnvironment.init();

const app = new Elysia();

app.get("/sse", async function* () {
    yield sse("hello");
    await setTimeout(1000);
    yield sse("world");
});

app.post(
    "/exec",
    async function* ({ body }) {
        const { code } = body;
        yield sse(code);
    },
    {
        body: t.Object({
            code: t.String(),
        }),
    },
);

app.listen(3080);

console.log(
    `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
