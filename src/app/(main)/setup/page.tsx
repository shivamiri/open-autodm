"use client";

/**
 * Setup Wizard - from fresh deployment to verified Meta webhook, five steps:
 *  1. Create a Meta app
 *  2. Save Instagram app credentials (stored encrypted)
 *  3. Wire the Meta portal (webhook + login redirect)
 *  4. Enable the background engine (one SQL snippet)
 *  5. Understand who can trigger it (testers, going public)
 */

import { useState } from "react";
import { motion } from "framer-motion";
import {
    Wrench, KeyRound, Webhook, Clock3, CheckCircle2, Copy, Check,
    ExternalLink, Loader2, ShieldCheck, AlertTriangle, Users
} from "lucide-react";
import { useSetupStatus, useSaveSetup } from "@/hooks/useSetup";
import { cn } from "@/lib/utils";

function CopyField({ label, value }: { label: string; value: string }) {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    return (
        <div>
            <label className="micro-label block mb-1">{label}</label>
            <div className="flex items-center gap-1.5">
                <code className="flex-1 text-[12px] font-mono bg-muted/60 border border-border rounded-lg px-3 py-2 break-all select-all">
                    {value}
                </code>
                <button
                    onClick={copy}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    title="Copy"
                >
                    {copied ? <Check className="w-3.5 h-3.5 text-secondary" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
            </div>
        </div>
    );
}

function NumberedList({ items }: { items: React.ReactNode[] }) {
    return (
        <ol className="space-y-2 list-none">
            {items.map((content, i) => (
                <li key={i} className="flex gap-2.5 text-[13px] text-foreground/90 leading-relaxed">
                    <span className="w-4.5 h-4.5 min-w-[18px] h-[18px] rounded-full bg-muted text-muted-foreground text-[10px] font-semibold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                    <span>{content}</span>
                </li>
            ))}
        </ol>
    );
}

function StepCard({
    step, title, icon: Icon, done, children,
}: {
    step: number;
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    done?: boolean;
    children: React.ReactNode;
}) {
    return (
        <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: step * 0.05 }}
            className="bg-card border border-border rounded-xl overflow-hidden"
        >
            <div className="flex items-center gap-3 px-5 h-12 border-b border-border">
                <div className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                    done ? "bg-secondary/10" : "bg-muted"
                )}>
                    {done ? <CheckCircle2 className="w-4 h-4 text-secondary" /> : <Icon className="w-4 h-4 text-muted-foreground" />}
                </div>
                <span className="micro-label">Step {step}</span>
                <h2 className="text-[13.5px] font-heading font-semibold text-foreground">{title}</h2>
            </div>
            <div className="p-5">{children}</div>
        </motion.section>
    );
}

const inputCls = "w-full h-9 text-[13px] font-mono bg-background border border-border rounded-lg px-3 outline-none focus:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/30 transition-colors";

export default function SetupPage() {
    const { data: setup, isLoading } = useSetupStatus();
    const saveMutation = useSaveSetup();

    const [appId, setAppId] = useState("");
    const [appSecret, setAppSecret] = useState("");
    const [fbAppSecret, setFbAppSecret] = useState("");
    const [configId, setConfigId] = useState("");
    const [saveError, setSaveError] = useState<string | null>(null);
    const [justSaved, setJustSaved] = useState(false);

    const handleSave = () => {
        setSaveError(null);
        saveMutation.mutate(
            {
                metaAppId: appId.trim(),
                metaAppSecret: appSecret.trim(),
                ...(fbAppSecret.trim() ? { metaFbAppSecret: fbAppSecret.trim() } : {}),
                ...(configId.trim() ? { metaConfigId: configId.trim() } : {}),
            },
            {
                onSuccess: () => { setJustSaved(true); setAppSecret(""); setFbAppSecret(""); setConfigId(""); },
                onError: (err) => setSaveError(err.message),
            }
        );
    };

    if (isLoading) {
        return (
            <div className="w-full max-w-2xl mx-auto py-24 flex justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const configured = !!setup?.configured;

    return (
        <div className="w-full max-w-2xl mx-auto space-y-4 pb-16">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-heading font-semibold tracking-tight text-foreground flex items-center gap-2">
                        <Wrench className="w-4.5 h-4.5 w-[18px] h-[18px] text-muted-foreground" />
                        Setup Wizard
                    </h1>
                    <p className="text-[13px] text-muted-foreground mt-1 max-w-md">
                        Connect your own free Meta developer app. Everything you enter is stored
                        encrypted in your Supabase database.
                    </p>
                </div>
                {configured && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-secondary bg-secondary/10 px-2.5 py-1 rounded-full shrink-0 mt-1">
                        <ShieldCheck className="w-3 h-3" /> Configured
                    </span>
                )}
            </div>

            {/* Step 1 */}
            <StepCard step={1} title="Create your Meta app" icon={ExternalLink} done={configured}>
                <NumberedList items={[
                    <>Go to <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="text-primary font-medium underline underline-offset-2">developers.facebook.com/apps</a> and click <b>Create App</b>.</>,
                    <>Use case <b>Other</b> → app type <b>Business</b>.</>,
                    <>Use case <b>Manage messaging &amp; content on Instagram</b>, then <b>Customize → API setup with Unified login</b> (Meta no longer offers Instagram login to new apps).</>,
                    <>Connect a <b>business portfolio</b> when asked, then <b>Create new configuration</b> with permissions <b>instagram_basic</b>, <b>instagram_manage_messages</b> and <b>instagram_manage_comments</b>. Copy its <b>Configuration ID</b> (config_id) and set the <b>Redirect URL</b> from Step 3 below.</>,
                    <>Copy the <b>Meta app ID</b> and <b>Meta app secret</b> from <b>App settings → Basic</b>. With Unified login these ARE the right pair - the exchange call uses them.</>,
                    <>Your Instagram must be a <b>Business or Creator</b> account (switch in the app: Settings → Account type).</>,
                ]} />
                <div className="mt-4 flex items-start gap-2 text-[12px] text-muted-foreground bg-muted/50 rounded-lg px-3 py-2.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
                    <span>
                        Your app starts in <b>Development mode</b> with <b>Standard Access</b> - perfect for building and testing
                        with accounts that hold a <b>role on your app</b> (you + testers - see Step 5). To serve the
                        general public, request <b>Advanced Access</b> via the free Meta App Review and switch to Live mode.
                    </span>
                </div>
            </StepCard>

            {/* Step 2 */}
            <StepCard step={2} title="Save your app credentials" icon={KeyRound} done={configured && !justSaved}>
                {configured && (
                    <div className="mb-4 flex items-center gap-2 text-[12px] font-medium text-secondary bg-secondary/10 rounded-lg px-3 py-2.5">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>Saved for app <code className="font-mono font-semibold">{setup?.metaAppId}</code>. Re-enter below only to change them.</span>
                    </div>
                )}
                <div className="space-y-3">
                    <div>
                        <label className="micro-label block mb-1">Meta app ID</label>
                        <input
                            value={appId}
                            onChange={(e) => setAppId(e.target.value)}
                            placeholder={setup?.metaAppId ?? "e.g. 1234567890123456"}
                            className={inputCls}
                        />
                    </div>
                    <div>
                        <label className="micro-label block mb-1">Meta app secret</label>
                        <input
                            type="password"
                            value={appSecret}
                            onChange={(e) => setAppSecret(e.target.value)}
                            placeholder="32-character hex secret"
                            className={inputCls}
                        />
                        <p className="text-[11px] text-muted-foreground mt-1">
                            Encrypted before it touches the database. Never logged, never shown again.
                        </p>
                    </div>
                    <div>
                        <label className="micro-label block mb-1">Facebook app secret <span className="normal-case font-normal opacity-70">(optional)</span></label>
                        <input
                            type="password"
                            value={fbAppSecret}
                            onChange={(e) => setFbAppSecret(e.target.value)}
                            placeholder="Only if webhook signature checks fail"
                            className={inputCls}
                        />
                        <p className="text-[11px] text-muted-foreground mt-1">
                            Meta signs webhooks with either secret depending on app type. If the debug panel shows
                            &ldquo;signature mismatch&rdquo; on real events, paste the App Secret from App settings → Basic here.
                        </p>
                    </div>
                    <div>
                        <label className="micro-label block mb-1">Configuration ID <span className="normal-case font-normal opacity-70">(Unified login)</span></label>
                        <input
                            value={configId}
                            onChange={(e) => setConfigId(e.target.value)}
                            placeholder={setup?.metaConfigId ?? "config_id from your Meta configuration"}
                            className={inputCls}
                        />
                        <p className="text-[11px] text-muted-foreground mt-1">
                            Meta portal → your app → API setup with Unified login → your configuration → Login URL:
                            the number after <code className="font-mono">config_id=</code>. Not a secret. Connect stays
                            disabled until this is saved.
                        </p>
                    </div>
                    {saveError && <p className="text-[12px] text-destructive font-medium">{saveError}</p>}
                    {justSaved && <p className="text-[12px] text-secondary font-medium">Saved. Continue with Step 3.</p>}
                    <button
                        onClick={handleSave}
                        disabled={saveMutation.isPending || !appId.trim() || !appSecret.trim()}
                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-foreground text-background text-[13px] font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                        {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                        {saveMutation.isPending ? "Saving…" : "Save credentials"}
                    </button>
                </div>
            </StepCard>

            {/* Step 3 */}
            <StepCard step={3} title="Wire up the Meta portal" icon={Webhook}>
                {!configured && !justSaved ? (
                    <p className="text-[13px] text-muted-foreground">Complete Step 2 first - your webhook verify token is generated when credentials are saved.</p>
                ) : (
                    <div className="space-y-5">
                        <div>
                            <p className="text-[13px] font-medium text-foreground mb-2.5">
                                A. Webhooks - <span className="text-muted-foreground font-normal">Meta portal → your app → Webhooks → Instagram</span>
                            </p>
                            <div className="space-y-2.5">
                                <CopyField label="Callback URL" value={setup?.webhookUrl ?? ""} />
                                <CopyField label="Verify token" value={setup?.webhookVerifyToken ?? ""} />
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-2">
                                Click <b>Verify and save</b>, then subscribe to <b>comments</b>, <b>messages</b>, <b>messaging_postbacks</b>, <b>message_reactions</b> and <b>message_edit</b>.
                            </p>
                        </div>
                        <div className="h-px bg-border" />
                        <div>
                            <p className="text-[13px] font-medium text-foreground mb-2.5">
                                B. Redirect URL - <span className="text-muted-foreground font-normal">API setup with Unified login → your configuration → Redirect URL</span>
                            </p>
                            <CopyField label="OAuth redirect URI" value={setup?.oauthRedirectUri ?? ""} />
                            <p className="text-[11px] text-muted-foreground mt-2">
                                Must match character-for-character.
                            </p>
                        </div>
                    </div>
                )}
            </StepCard>

            {/* Step 4 */}
            <StepCard step={4} title="Enable the background engine" icon={Clock3}>
                <p className="text-[13px] text-muted-foreground mb-3 leading-relaxed">
                    Most DMs send instantly from the webhook. This cron delivers the rest - rate-limited overflow
                    and retries. In <b>Supabase → SQL Editor</b>, replace{" "}
                    <code className="font-mono text-[11px] bg-muted px-1 rounded">YOUR_CRON_SECRET</code> with your
                    deployment&apos;s CRON_SECRET and run:
                </p>
                <div className="relative">
                    <pre className="text-[11px] font-mono bg-zinc-950 text-zinc-300 rounded-lg p-3.5 overflow-x-auto whitespace-pre border border-border">
                        {setup?.cronSnippet ?? ""}
                    </pre>
                    <button
                        onClick={() => void navigator.clipboard.writeText(setup?.cronSnippet ?? "")}
                        className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
                        title="Copy SQL"
                    >
                        <Copy className="w-3 h-3" />
                    </button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                    Verify with <code className="font-mono bg-muted px-1 rounded">select * from cron.job;</code> - you should see <code className="font-mono bg-muted px-1 rounded">open-autodm-process-jobs</code>.
                </p>
            </StepCard>

            {/* Step 5 */}
            <StepCard step={5} title="Who can trigger it" icon={Users}>
                <div className="space-y-4 text-[13px] text-foreground/90 leading-relaxed">
                    <p>
                        Per Meta&apos;s docs, <b>Standard Access</b> (what a new app gets) is enough to test with people who
                        hold a <b>role on your app</b> - the connected account and any testers you add below. Serving the
                        general public needs <b>Advanced Access</b> and Live mode. Which audience events reach you in dev
                        mode is something we&apos;ll confirm with a live test once connected.
                    </p>
                    <div>
                        <p className="font-medium text-foreground mb-2">Add a tester account:</p>
                        <NumberedList items={[
                            <>Meta portal → your app → <b>API setup with Unified login → Generate access tokens → Add account</b>.</>,
                            <>Invite the Instagram professional account as an <b>Instagram Tester</b>.</>,
                            <>They accept <b>on Instagram on the web</b>: Settings → Website permissions → Apps and websites → <b>Tester Invites</b>.</>,
                        ]} />
                    </div>
                    <div className="flex items-start gap-2 text-[12px] text-muted-foreground bg-muted/50 rounded-lg px-3 py-2.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
                        <span>
                            <b>Going public:</b> to onboard people beyond your app&apos;s roles, request <b>Advanced Access</b> via
                            Meta&apos;s free App Review - upload a short screencast of your working flow - and switch the app to
                            Live mode. Nothing in this app changes afterwards.
                        </span>
                    </div>
                </div>
            </StepCard>

            {configured && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl border border-secondary/25 bg-secondary/5 p-4 flex items-start gap-3"
                >
                    <CheckCircle2 className="w-4.5 h-4.5 w-[18px] h-[18px] text-secondary shrink-0 mt-0.5" />
                    <div>
                        <p className="text-[13px] font-semibold text-foreground">Setup complete - connect Instagram next</p>
                        <p className="text-[13px] text-muted-foreground mt-0.5">
                            Go to <a href="/settings" className="text-primary font-medium underline underline-offset-2">Settings</a> and
                            click <b>Connect</b>, using the Instagram account that owns (or tests) your Meta app.
                        </p>
                    </div>
                </motion.div>
            )}
        </div>
    );
}
