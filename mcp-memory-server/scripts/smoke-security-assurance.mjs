import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync, chmodSync, lstatSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generatedFilePathLabelSchema } from "../dist/artifact-schema.js";
import { evalRelativePathSchema, evalTaskSourceSchema } from "../dist/eval-schema.js";
import { formatHostAuthority, normalizeHostAuthority, normalizeHttpHost, parseHttpPort } from "../dist/http-security.js";
import { portablePathCollisionKey, portableRelativePathIssue } from "../dist/path-security.js";
import { hardenPrivatePath, posixOwnerIsTrusted, posixPrivateMetadataIsSafe, windowsPrivateAclHardeningPlan, windowsPrivateAclIsSafe, windowsReplacementAclIsSafe } from "../dist/platform-security.js";
import { projectEnvironment } from "../dist/project-environment.js";
import { securityDoctor } from "../dist/security-doctor.js";

const root = mkdtempSync(join(tmpdir(), "cairn-security-assurance-"));
const project = join(root, "project");
mkdirSync(join(project, ".ai"), { recursive: true });
if (process.platform !== "win32") chmodSync(project, 0o755);
hardenPrivatePath(join(project, ".ai"));

try {
    let report = securityDoctor({ projectRoot: project, env: {} });
    assert.equal(report.ok, true);
    assert.equal(report.checks.find(({ id }) => id === "http-exposure")?.state, "SKIP");

    const privateEnv = join(project, ".ai", ".env");
    writeFileSync(privateEnv, "CAIRN_CONTEXT_PACKS=1\n", { mode: 0o600 });
    hardenPrivatePath(privateEnv);

    const safeEnvironment = [
        "SAFE_UNQUOTED=alpha-1.2:/path,@value=ok",
        "SAFE_SINGLE='spaces ; | & < > ( ) remain quoted'",
        'SAFE_DOUBLE="spaces ; | & < > ( ) remain quoted"',
        "",
    ].join("\n");
    writeFileSync(privateEnv, safeEnvironment, { mode: 0o600 });
    const safeLoaded = projectEnvironment(project, {});
    assert.equal(safeLoaded.issue, undefined);
    if (process.platform !== "win32") {
        const sourced = spawnSync("/bin/sh", ["-c", '. "$1"; printf "%s\\n%s\\n%s" "$SAFE_UNQUOTED" "$SAFE_SINGLE" "$SAFE_DOUBLE"', "sh", privateEnv], { encoding: "utf8" });
        assert.equal(sourced.status, 0, sourced.stderr);
        assert.equal(sourced.stdout, [safeLoaded.env.SAFE_UNQUOTED, safeLoaded.env.SAFE_SINGLE, safeLoaded.env.SAFE_DOUBLE].join("\n"));
    }
    for (const expression of ["foo;id", "foo|id", "foo&id", "foo>out", "foo<input", "(id)", "foo\\ bar", "~/secret", "${HOME}", "$((1+1))", " id"]) {
        writeFileSync(privateEnv, `UNSAFE=${expression}\n`, { mode: 0o600 });
        assert.match(projectEnvironment(project, {}).issue ?? "", /literal|expansion|quoted|whitespace/i, `unsafe shell grammar accepted: ${expression}`);
    }
    writeFileSync(privateEnv, Buffer.from('UNSAFE="a\0b"\n'));
    assert.match(projectEnvironment(project, {}).issue ?? "", /control character/i);
    writeFileSync(privateEnv, "CAIRN_CONTEXT_PACKS=1\n", { mode: 0o600 });
    hardenPrivatePath(privateEnv);
    report = securityDoctor({ projectRoot: project, env: {} });
    assert.equal(report.checks.find(({ id }) => id === "private-file:.ai/.env")?.state, "PASS");

    writeFileSync(privateEnv, "MCP_HTTP_PORT=7801\nCAIRN_MEMORY_HTTP_TOKEN=short\n", { mode: 0o600 });
    const loaded = projectEnvironment(project, {});
    assert.equal(loaded.issue, undefined);
    report = securityDoctor({ projectRoot: project, env: loaded.env, environmentIssue: loaded.issue });
    assert.equal(report.ok, false, "project .ai/.env participates in posture checks");
    const overridden = projectEnvironment(project, { CAIRN_MEMORY_HTTP_TOKEN: "ambient-synthetic-token-0123456789abcdef", MCP_HTTP_PORT: "7801" });
    report = securityDoctor({ projectRoot: project, env: overridden.env, environmentIssue: overridden.issue });
    assert.equal(report.ok, true, "ambient environment takes precedence over project .ai/.env");
    writeFileSync(privateEnv, "CAIRN_CONTEXT_PACKS=1\n", { mode: 0o600 });

    if (process.platform !== "win32") {
        chmodSync(privateEnv, 0o644);
        report = securityDoctor({ projectRoot: project, env: {} });
        assert.equal(report.ok, false);
        assert.equal(report.checks.find(({ id }) => id === "private-file:.ai/.env")?.state, "FAIL");
        chmodSync(privateEnv, 0o600);
    }

    report = securityDoctor({ projectRoot: project, env: { MCP_HTTP_PORT: "7801" } });
    assert.equal(report.ok, false);
    assert.equal(report.checks.find(({ id }) => id === "http-token")?.state, "FAIL");

    const tokenFile = join(root, "http-token");
    writeFileSync(tokenFile, "file-backed-synthetic-token-0123456789abcdef\n", { mode: 0o600 });
    hardenPrivatePath(tokenFile);
    report = securityDoctor({ projectRoot: project, env: {
        MCP_HTTP_PORT: "7801",
        CAIRN_MEMORY_HTTP_TOKEN_FILE: tokenFile,
    } });
    assert.equal(report.ok, true);
    assert.equal(report.checks.find(({ id }) => id === "http-token-file")?.state, "PASS");
    assert.equal(JSON.stringify(report).includes("file-backed-synthetic-token"), false);
    writeFileSync(tokenFile, "first-valid-looking-token-0123456789\nsecond-line\n", { mode: 0o600 });
    report = securityDoctor({ projectRoot: project, env: { MCP_HTTP_PORT: "7801", CAIRN_MEMORY_HTTP_TOKEN_FILE: tokenFile } });
    assert.equal(report.ok, false, "multiline token file is not a valid Bearer value");
    writeFileSync(tokenFile, "file-backed-synthetic-token-0123456789abcdef\n", { mode: 0o600 });

    report = securityDoctor({ projectRoot: project, env: {
        MCP_HTTP_PORT: "7801",
        CAIRN_MEMORY_HTTP_TOKEN: "x".repeat(32),
    } });
    assert.equal(report.ok, false, "repeated token is weak despite its length");
    report = securityDoctor({ projectRoot: project, env: {
        MCP_HTTP_PORT: "7801",
        CAIRN_MEMORY_HTTP_TOKEN: "🪨".repeat(8),
    } });
    assert.equal(report.ok, false, "non-ASCII token cannot be represented as a Bearer header");
    assert.equal(report.checks.some(({ id, state }) => id === "http-token" && state === "FAIL"), true);

    const plantedToken = "security-doctor-secret-sentinel-".repeat(2);
    report = securityDoctor({ projectRoot: project, env: {
        MCP_HTTP_PORT: "7801",
        MCP_HTTP_HOST: "0.0.0.0",
        CAIRN_MEMORY_HTTP_TOKEN: plantedToken,
        CAIRN_MCP_TOOL_PROFILE: "read-only",
        CAIRN_MEMORY_HTTP_ALLOWED_HOSTS: "memory.example.test:7801",
    } });
    assert.equal(report.ok, true);
    assert.equal(report.checks.find(({ id }) => id === "http-least-authority")?.state, "PASS");
    assert.equal(JSON.stringify(report).includes(plantedToken), false, "security report leaked a token");

    report = securityDoctor({ projectRoot: project, env: {
        MCP_HTTP_PORT: "7801",
        MCP_HTTP_HOST: "0.0.0.0",
        CAIRN_MEMORY_HTTP_TOKEN: plantedToken,
    } });
    assert.equal(report.ok, true);
    assert.equal(report.checks.find(({ id }) => id === "http-least-authority")?.state, "WARN");

    report = securityDoctor({ projectRoot: project, env: { CAIRN_MEMORY_REMOTE_URL: "http://memory.example.test/mcp" } });
    assert.equal(report.ok, true);
    assert.equal(report.checks.find(({ id }) => id === "remote-transport")?.state, "WARN");
    report = securityDoctor({ projectRoot: project, env: { CAIRN_MEMORY_REMOTE_URL: "not a url" } });
    assert.equal(report.ok, false);
    report = securityDoctor({ projectRoot: project, env: { CAIRN_MEMORY_REMOTE_URL: "file:///tmp/not-http" } });
    assert.equal(report.ok, false);
    report = securityDoctor({ projectRoot: project, env: { CAIRN_MEMORY_REMOTE_URL: "https://user:plantedcredentialvalue@memory.example.test/mcp" } });
    assert.equal(report.ok, false);
    assert.equal(JSON.stringify(report).includes("plantedcredentialvalue"), false);
    assert.equal(normalizeHttpHost(undefined), "127.0.0.1");
    assert.equal(normalizeHttpHost("  "), "127.0.0.1");
    assert.equal(normalizeHttpHost("0.0.0.0"), "0.0.0.0");
    assert.deepEqual(parseHttpPort(undefined), { enabled: false });
    assert.deepEqual(parseHttpPort("7801"), { enabled: true, port: 7801 });
    for (const invalid of ["1e3", "0x1e79", "+7801", "7801x", " ", "0", "65536", "07801", "7801 "]) {
        assert.equal("error" in parseHttpPort(invalid), true, `invalid HTTP port accepted: ${JSON.stringify(invalid)}`);
        report = securityDoctor({ projectRoot: project, env: { MCP_HTTP_PORT: invalid } });
        assert.equal(report.checks.find(({ id }) => id === "http-exposure")?.state, "FAIL");
    }
    assert.equal(formatHostAuthority("::1", 7801), "[::1]:7801");
    assert.equal(normalizeHostAuthority("[::1]:7801"), "[::1]:7801");
    assert.equal(normalizeHostAuthority("MEMORY.EXAMPLE.TEST:7801"), "memory.example.test:7801");
    assert.equal(normalizeHostAuthority("127.0.0.1:80"), "127.0.0.1:80");
    assert.equal(normalizeHostAuthority("localhost", 80), "localhost:80");
    assert.equal(normalizeHostAuthority("[::1]", 80), "[::1]:80");
    assert.equal(normalizeHostAuthority("example.test:443"), "example.test:443");
    assert.equal(normalizeHostAuthority("[::1]:80"), "[::1]:80");
    assert.equal(normalizeHostAuthority(" memory.example.test:7801"), undefined);
    for (const port of ["80", "443"]) {
        report = securityDoctor({ projectRoot: project, env: { MCP_HTTP_PORT: port, CAIRN_MEMORY_HTTP_TOKEN: "default-port-token-".repeat(3) } });
        assert.equal(report.ok, true, `doctor rejected valid default HTTP port ${port}`);
    }

    let state = 0x6d2b79f5;
    const next = () => {
        state = Math.imul(state ^ (state >>> 15), state | 1);
        state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
        return ((state ^ (state >>> 14)) >>> 0);
    };
    for (let index = 0; index < 1_000; index += 1) {
        const path = `dir-${next().toString(16)}/file-${next().toString(16)}.md`;
        assert.equal(portableRelativePathIssue(path), undefined);
        assert.equal(generatedFilePathLabelSchema.safeParse(path).success, true);
        assert.equal(evalRelativePathSchema.safeParse(path).success, true);
    }

    const unsafe = [
        "../escape", "a/../escape", "a//b", "a/./b", "/absolute", "C:/windows/system32",
        "C:\\windows\\system32", "//server/share", "folder/NUL", "folder/com1.txt", "name:stream",
        "trailing./file ", "e\u0301/file.md", "control\u0000byte", "a?.md", "a*.md",
        "a<.md", "a>.md", 'a".md', "a|.md", "COM¹.txt", "LPT²", "bad\ud800.md",
        "CONIN$", "folder/CONOUT$.log",
    ];
    for (const path of unsafe) {
        assert.ok(portableRelativePathIssue(path), `unsafe path accepted: ${JSON.stringify(path)}`);
        assert.equal(generatedFilePathLabelSchema.safeParse(path).success, false);
        assert.equal(evalRelativePathSchema.safeParse(path).success, false);
    }
    assert.equal(portablePathCollisionKey("Docs/Guide.md"), portablePathCollisionKey("docs/guide.md"));
    for (const [left, right] of [["σ.md", "ς.md"], ["s.md", "ſ.md"], ["i.md", "ı.md"], ["café.md", "cafe\u0301.md"]]) {
        assert.equal(portablePathCollisionKey(left), portablePathCollisionKey(right), `portable collision missed: ${left}/${right}`);
    }
    assert.equal(evalRelativePathSchema.safeParse(".").success, true, "evaluation root remains a valid workspace path");
    assert.equal(evalTaskSourceSchema.safeParse({ kind: "bundled_fake", identifier: "cairn-offline-fake-v1", files: [{ path: ".", content: "x" }] }).success, false, "bundled file cannot alias its source root");
    assert.equal(evalTaskSourceSchema.safeParse({ kind: "bundled_fake", identifier: "cairn-offline-fake-v1", files: [{ path: "docs.md", content: "x" }, { path: "Docs.md", content: "y" }] }).success, false, "bundled files must be portably unique");
    if (process.platform === "win32") {
        const portableFs = join(root, "portable-fs");
        mkdirSync(portableFs);
        for (const name of ["plain.md", "café.md", "emoji-🪨.md"]) {
            assert.equal(portableRelativePathIssue(name), undefined);
            writeFileSync(join(portableFs, name), "portable\n");
        }
    }

    if (process.platform !== "win32") {
        const fifoProject = join(root, "fifo-project");
        mkdirSync(join(fifoProject, ".ai"), { recursive: true });
        chmodSync(fifoProject, 0o755);
        chmodSync(join(fifoProject, ".ai"), 0o700);
        const envFifo = join(fifoProject, ".ai", ".env");
        const tokenFifo = join(fifoProject, ".ai", "token");
        spawnSync("mkfifo", [envFifo, tokenFifo], { encoding: "utf8" });
        const environmentModule = pathToFileURL(fileURLToPath(new URL("../dist/project-environment.js", import.meta.url))).href;
        const httpModule = pathToFileURL(fileURLToPath(new URL("../dist/http-security.js", import.meta.url))).href;
        const fifoProbe = spawnSync(process.execPath, ["--input-type=module", "--eval", [
            `const environment = await import(${JSON.stringify(environmentModule)});`,
            `const http = await import(${JSON.stringify(httpModule)});`,
            `const loaded = environment.projectEnvironment(${JSON.stringify(fifoProject)}, {});`,
            `const token = http.resolveHttpToken({ CAIRN_MEMORY_HTTP_TOKEN_FILE: ${JSON.stringify(tokenFifo)} });`,
            "if (!loaded.issue || token.ok || token.reason !== 'file-unsafe') process.exit(2);",
        ].join("\n")], { encoding: "utf8", timeout: 2_000 });
        assert.notEqual(fifoProbe.error?.code, "ETIMEDOUT", "FIFO configuration probes must never block");
        assert.equal(fifoProbe.status, 0, fifoProbe.stderr);

        const bootstrappedProject = mkdtempSync(join(root, "bootstrapped-project-"));
        const bootstrap = fileURLToPath(new URL("../../scripts/bootstrap.sh", import.meta.url));
        const bootstrapped = spawnSync(bootstrap, [bootstrappedProject], { encoding: "utf8" });
        assert.equal(bootstrapped.status, 0, bootstrapped.stderr);
        assert.equal((lstatSync(join(bootstrappedProject, ".ai")).mode & 0o777), 0o700, "bootstrap creates a private .ai directory");
        const bootstrappedReport = securityDoctor({ projectRoot: bootstrappedProject, env: {} });
        assert.equal(bootstrappedReport.ok, true, `fresh bootstrap passes the security doctor: ${JSON.stringify(bootstrappedReport)}`);

        const outside = join(root, "outside-ai");
        const redirected = join(root, "redirected-project");
        mkdirSync(outside);
        mkdirSync(redirected);
        chmodSync(redirected, 0o755);
        writeFileSync(join(outside, ".env"), "MCP_HTTP_PORT=7801\n", { mode: 0o600 });
        symlinkSync(outside, join(redirected, ".ai"));
        report = securityDoctor({ projectRoot: redirected, env: {} });
        assert.equal(report.ok, false);
        assert.equal(report.checks.find(({ id }) => id === "private-directory:.ai")?.state, "FAIL");
        assert.equal(report.checks.find(({ id }) => id === "private-file:.ai/.env")?.state, "SKIP");

        const dangling = join(root, "dangling-project");
        mkdirSync(join(dangling, ".ai"), { recursive: true });
        chmodSync(dangling, 0o755);
        chmodSync(join(dangling, ".ai"), 0o700);
        symlinkSync(join(root, "missing-env"), join(dangling, ".ai", ".env"));
        report = securityDoctor({ projectRoot: dangling, env: {} });
        assert.equal(report.ok, false);
        assert.equal(report.checks.find(({ id }) => id === "private-file:.ai/.env")?.state, "FAIL");

        const writable = join(root, "writable-project");
        mkdirSync(join(writable, ".ai"), { recursive: true });
        chmodSync(writable, 0o755);
        chmodSync(join(writable, ".ai"), 0o777);
        report = securityDoctor({ projectRoot: writable, env: {} });
        assert.equal(report.checks.find(({ id }) => id === "private-directory:.ai")?.state, "FAIL");

        const writableRoot = join(root, "writable-root-project");
        mkdirSync(join(writableRoot, ".ai"), { recursive: true });
        chmodSync(writableRoot, 0o777);
        chmodSync(join(writableRoot, ".ai"), 0o700);
        report = securityDoctor({ projectRoot: writableRoot, env: {} });
        assert.equal(report.checks.find(({ id }) => id === "project-root")?.state, "FAIL");
        assert.equal(report.checks.find(({ id }) => id === "mcp-profile")?.state, "SKIP");
        assert.match(projectEnvironment(writableRoot, {}).issue ?? "", /owner-controlled/);
        report = securityDoctor({ projectRoot: writableRoot, env: {
            MCP_HTTP_PORT: "7801",
            CAIRN_MEMORY_HTTP_TOKEN_FILE: ".ai/token",
        } });
        assert.equal(report.checks.find(({ id }) => id === "http-token-file")?.state, "FAIL", "relative token is not read through a rejected root");

        const writableParent = join(root, "writable-parent");
        const child = join(writableParent, "project");
        mkdirSync(join(child, ".ai"), { recursive: true });
        chmodSync(writableParent, 0o777);
        chmodSync(child, 0o755);
        chmodSync(join(child, ".ai"), 0o700);
        report = securityDoctor({ projectRoot: child, env: {} });
        assert.equal(report.checks.find(({ id }) => id === "project-root-parent")?.state, "FAIL");
        assert.match(projectEnvironment(child, {}).issue ?? "", /owner-controlled/);

        const raceProject = join(root, "race-project");
        const raceMoved = join(root, "race-project-moved");
        const raceTarget = join(root, "race-target");
        mkdirSync(join(raceProject, ".ai"), { recursive: true });
        mkdirSync(join(raceTarget, ".ai"), { recursive: true });
        chmodSync(raceProject, 0o755);
        chmodSync(raceTarget, 0o755);
        chmodSync(join(raceProject, ".ai"), 0o700);
        chmodSync(join(raceTarget, ".ai"), 0o700);
        report = securityDoctor({ projectRoot: raceProject, env: {}, testBeforeCanonicalize: () => {
            renameSync(raceProject, raceMoved);
            symlinkSync(raceTarget, raceProject);
        } });
        assert.equal(report.checks.find(({ id }) => id === "project-root")?.state, "FAIL", "root replacement during canonicalization is rejected");
    }

    const currentSid = "S-1-5-21-1000";
    const baseAcl = { owner_sid: currentSid, protected: true, access: [{ sid: currentSid, type: "Allow", rights: 2032127 }] };
    assert.equal(windowsPrivateAclIsSafe(baseAcl, currentSid), true);
    assert.equal(windowsPrivateAclIsSafe({ ...baseAcl, access: [...baseAcl.access, { sid: "S-1-5-21-9999", type: "Allow", rights: 131241 }] }, currentSid), false);
    assert.equal(windowsPrivateAclIsSafe({ ...baseAcl, access: [...baseAcl.access, { sid: "NOT-S-1-5-32-544", type: "Allow", rights: 2032127 }] }, currentSid), false);
    const hardeningPlan = windowsPrivateAclHardeningPlan({
        ...baseAcl,
        protected: false,
        access: [
            ...baseAcl.access,
            { sid: "S-1-1-0", type: "Allow", rights: 131241 },
            { sid: "S-1-5-21-9999", type: "Deny", rights: 131241 },
        ],
    }, { account: "HOST\\agent", sid: currentSid }, false);
    assert.deepEqual(hardeningPlan, [
        ["/grant:r", `*${currentSid}:(F)`],
        ["/inheritance:r"],
        ["/remove:g", "*S-1-1-0"],
        ["/remove:d", "*S-1-5-21-9999"],
        ["/setowner", "HOST\\agent"],
    ]);
    assert.equal(hardeningPlan.some((operation) => operation.includes("/reset")), false, "hardening must never broaden access from the parent ACL");
    assert.equal(hardeningPlan.findIndex((operation) => operation.includes("/inheritance:r"))
        < hardeningPlan.findIndex((operation) => operation.includes("/remove:g")), true, "inherited access is removed before explicit grants");
    assert.equal(hardeningPlan.findIndex((operation) => operation.includes("/remove:g"))
        < hardeningPlan.findIndex((operation) => operation.includes("/remove:d")), true, "denies are removed only after untrusted grants");
    assert.equal(windowsReplacementAclIsSafe({ ...baseAcl, protected: false, access: [...baseAcl.access, { sid: "S-1-5-21-9999", type: "Allow", rights: 131241 }] }, currentSid), true);
    assert.equal(windowsReplacementAclIsSafe({ ...baseAcl, access: [...baseAcl.access, { sid: "S-1-5-21-9999", type: "Allow", rights: 2 }] }, currentSid), false);
    assert.equal(posixOwnerIsTrusted(1000, 1000), true);
    assert.equal(posixOwnerIsTrusted(0, 1000), true);
    assert.equal(posixOwnerIsTrusted(1001, 1000), false);
    if (process.platform !== "win32") {
        assert.equal(posixPrivateMetadataIsSafe({ uid: process.getuid() + 1, mode: 0o600 }), false);
        assert.equal(posixPrivateMetadataIsSafe({ uid: process.getuid(), mode: 0o644 }), false);
    }

    const cliEnv = { ...process.env };
    for (const key of ["MCP_HTTP_PORT", "CAIRN_MEMORY_HTTP_TOKEN", "CAIRN_MEMORY_HTTP_TOKEN_FILE"]) delete cliEnv[key];
    const runDoctorCli = () => {
        const cli = fileURLToPath(new URL("../dist/security-cli.js", import.meta.url));
        const result = spawnSync(process.execPath, [cli, "doctor", "--project", project, "--json"], { cwd: root, env: cliEnv, encoding: "utf8" });
        assert.ok(result.stdout, result.stderr);
        return { result, report: JSON.parse(result.stdout) };
    };
    const relativeToken = join(project, ".ai", "token");
    writeFileSync(relativeToken, `${"safe-relative-token-".repeat(3)}\n`, { mode: 0o600 });
    hardenPrivatePath(relativeToken);
    writeFileSync(privateEnv, "MCP_HTTP_PORT=7801\nCAIRN_MEMORY_HTTP_TOKEN_FILE=.ai/token\n", { mode: 0o600 });
    hardenPrivatePath(privateEnv);
    assert.equal(runDoctorCli().report.ok, true, "relative token is resolved from selected project");
    writeFileSync(relativeToken, "weak\n", { mode: 0o600 });
    assert.equal(runDoctorCli().report.checks.find(({ id }) => id === "http-token")?.state, "FAIL");
    rmSync(relativeToken);
    assert.equal(runDoctorCli().report.checks.find(({ id }) => id === "http-token-file")?.state, "FAIL");
    if (process.platform !== "win32") {
        const outsideToken = join(root, "outside-token");
        writeFileSync(outsideToken, `${"outside-safe-token-".repeat(3)}\n`, { mode: 0o600 });
        symlinkSync(outsideToken, relativeToken);
        assert.equal(runDoctorCli().report.checks.find(({ id }) => id === "http-token-file")?.state, "FAIL");
        rmSync(relativeToken);

        for (const mode of [0o600, 0o000]) {
            chmodSync(join(project, ".ai"), mode);
            const invocation = runDoctorCli();
            assert.equal(invocation.result.status, 1);
            assert.equal(invocation.report.checks.find(({ id }) => id === "private-directory:.ai")?.state, "FAIL");
            chmodSync(join(project, ".ai"), 0o700);
        }
    }
    writeFileSync(privateEnv, "X=" + "x".repeat(64 * 1024) + "\n", { mode: 0o600 });
    assert.match(projectEnvironment(project, {}).issue ?? "", /64 KiB/);

    console.log("PASS: security doctor, HTTP parsing, ACL identity, and portable-path adversarial contract");
} finally {
    rmSync(root, { recursive: true, force: true });
}
