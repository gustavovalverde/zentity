"use client";

import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  InformationCircleIcon,
  Search01Icon,
  ShoppingCart01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AssuranceBadges } from "@/components/shared/assurance-badges";
import { Button } from "@/components/ui/button";
import type { Product, ShoppingTask } from "@/data/aether";
import type { CibaState } from "@/hooks/use-ciba-flow";
import { env } from "@/lib/env";

interface AgentMessage {
  content?: string | undefined;
  id: string;
  pick?: Product | undefined;
  products?: Product[] | undefined;
  total?: number | undefined;
  type: "text" | "products" | "cart" | "ciba-waiting" | "result";
}

interface AgentChatProps {
  cibaState: CibaState;
  error: string | null;
  exchangedTokens: Record<string, unknown> | null;
  onReset: () => void;
  onTriggerCiba: () => void;
  task: ShoppingTask;
  tokens: Record<string, unknown> | null;
  userInfo: Record<string, unknown> | null;
}

function resolvePick(task: ShoppingTask): Product {
  const match = task.results.find((p) => p.id === task.pick);
  if (match) {
    return match;
  }
  const first = task.results[0];
  if (!first) {
    throw new Error(`Task "${task.id}" has no results`);
  }
  return first;
}

function buildScript(
  task: ShoppingTask
): { delay: number; msg: AgentMessage }[] {
  const picked = resolvePick(task);
  const tax = picked.price * 0.0875;
  const total = picked.price + tax;

  return [
    {
      delay: 800,
      msg: {
        id: "search",
        type: "text",
        content: `Searching for "${task.prompt}"...`,
      },
    },
    {
      delay: 2000,
      msg: {
        id: "found",
        type: "text",
        content: `Found ${task.results.length} top options within your $${task.budget} budget. Comparing reviews, specs, and prices.`,
      },
    },
    {
      delay: 2200,
      msg: { id: "products", type: "products", products: task.results },
    },
    {
      delay: 2000,
      msg: {
        id: "recommendation",
        type: "text",
        content: `Best value: **${picked.brand} ${picked.name}** at $${picked.price}. Top-rated with ${picked.rating}/5 stars. Adding to cart.`,
      },
    },
    {
      delay: 1800,
      msg: { id: "cart", type: "cart", pick: picked, total },
    },
    {
      delay: 1500,
      msg: {
        id: "checkout",
        type: "text",
        content: `Ready to complete your purchase. Total: **$${total.toFixed(2)}** (incl. tax). I need your authorization to proceed.`,
      },
    },
  ];
}

export function AgentChat({
  task,
  cibaState,
  tokens,
  exchangedTokens,
  userInfo,
  error,
  onTriggerCiba,
  onReset,
}: AgentChatProps) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [typing, setTyping] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scriptRef = useRef(buildScript(task));
  const cibaSentRef = useRef(false);
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef(onTriggerCiba);
  triggerRef.current = onTriggerCiba;

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  // Play the script, then trigger CIBA
  useEffect(() => {
    const script = scriptRef.current;
    let step = 0;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    function next() {
      const entry = script[step];
      if (!entry) {
        setTyping(false);
        if (!(cancelled || cibaSentRef.current)) {
          cibaSentRef.current = true;
          timer = setTimeout(() => triggerRef.current(), 800);
        }
        return;
      }
      const { delay, msg } = entry;
      timer = setTimeout(() => {
        if (cancelled) {
          return;
        }
        setMessages((prev) => [...prev, msg]);
        setTimeout(scrollToBottom, 50);
        step++;
        next();
      }, delay);
    }

    next();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (replayTimerRef.current) {
        clearTimeout(replayTimerRef.current);
      }
    };
  }, [scrollToBottom]);

  const handleReset = useCallback(() => {
    if (replayTimerRef.current) {
      clearTimeout(replayTimerRef.current);
    }
    setMessages([]);
    setTyping(true);
    cibaSentRef.current = false;
    scriptRef.current = buildScript(task);
    onReset();
    const script = scriptRef.current;
    let step = 0;
    function next() {
      const entry = script[step];
      if (!entry) {
        setTyping(false);
        return;
      }
      const { delay, msg } = entry;
      replayTimerRef.current = setTimeout(() => {
        setMessages((prev) => [...prev, msg]);
        setTimeout(scrollToBottom, 50);
        step++;
        next();
      }, delay);
    }
    replayTimerRef.current = setTimeout(next, 500);
  }, [task, onReset, scrollToBottom]);

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-6"
        ref={scrollRef}
      >
        {messages.map((msg) => (
          <ChatBubble key={msg.id} message={msg} />
        ))}

        {typing && <TypingIndicator />}

        {/* CIBA states */}
        {(cibaState === "requesting" || cibaState === "polling") && (
          <CibaWaiting state={cibaState} />
        )}
        {cibaState === "approved" && tokens && exchangedTokens && (
          <div className="fade-in max-w-[85%] animate-in rounded-xl rounded-bl-sm bg-white/10 px-4 py-3 duration-300">
            <p className="text-sm text-white/80 leading-relaxed">
              Narrowing permissions for the merchant API...
            </p>
          </div>
        )}
        {cibaState === "approved" && tokens && (
          <CibaResult
            exchangedTokens={exchangedTokens}
            onReset={handleReset}
            pick={resolvePick(task)}
            tokens={tokens}
            userInfo={userInfo}
          />
        )}
        {cibaState === "denied" && (
          <CibaOutcome
            description="You denied the authorization request. The purchase was not completed."
            icon={Cancel01Icon}
            iconColor="text-red-400"
            onReset={handleReset}
            title="Authorization Denied"
          />
        )}
        {cibaState === "expired" && (
          <CibaOutcome
            description="The authorization request expired. You can try again."
            icon={Clock01Icon}
            iconColor="text-yellow-400"
            onReset={handleReset}
            title="Request Expired"
          />
        )}
        {cibaState === "error" && (
          <CibaOutcome
            description={error ?? "Something went wrong. Please try again."}
            icon={Cancel01Icon}
            iconColor="text-red-400"
            onReset={handleReset}
            title="Error"
          />
        )}
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: AgentMessage }) {
  if (message.type === "products" && message.products) {
    return (
      <div className="fade-in animate-in duration-500">
        <div className="mb-1.5 flex items-center gap-1.5 text-white/50 text-xs">
          <HugeiconsIcon icon={Search01Icon} size={12} />
          Top results
        </div>
        <div className="space-y-2">
          {message.products.map((p) => (
            <div
              className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3"
              key={p.id}
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-white/10 font-bold text-sm text-white/60">
                {p.rating}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-sm">
                  {p.brand} {p.name}
                </p>
                <p className="truncate text-white/50 text-xs">{p.snippet}</p>
              </div>
              <span className="shrink-0 font-mono text-sm text-white/70">
                ${p.price}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (message.type === "cart" && message.pick) {
    return (
      <div className="fade-in animate-in duration-500">
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <div className="mb-2 flex items-center gap-1.5 text-white/50 text-xs">
            <HugeiconsIcon icon={ShoppingCart01Icon} size={12} />
            Cart
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">
                {message.pick.brand} {message.pick.name}
              </p>
              <p className="text-white/50 text-xs">Qty: 1</p>
            </div>
            <span className="font-mono text-sm">${message.pick.price}</span>
          </div>
          <div className="mt-3 flex justify-between border-white/10 border-t pt-3 font-medium text-sm">
            <span className="text-white/60">Total (incl. tax)</span>
            <span className="font-mono">${message.total?.toFixed(2)}</span>
          </div>
        </div>
      </div>
    );
  }

  // Default text bubble
  return (
    <div className="fade-in animate-in duration-500">
      <div className="max-w-[85%] rounded-xl rounded-bl-sm bg-white/10 px-4 py-3">
        <p className="text-sm leading-relaxed">
          <FormattedText text={message.content ?? ""} />
        </p>
      </div>
    </div>
  );
}

function FormattedText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <span className="font-semibold text-white" key={part}>
              {part.slice(2, -2)}
            </span>
          );
        }
        return <span key={part}>{part}</span>;
      })}
    </>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-2">
      <div className="size-1.5 animate-bounce rounded-full bg-white/40 [animation-delay:0ms]" />
      <div className="size-1.5 animate-bounce rounded-full bg-white/40 [animation-delay:150ms]" />
      <div className="size-1.5 animate-bounce rounded-full bg-white/40 [animation-delay:300ms]" />
    </div>
  );
}

function CibaWaiting({ state }: { state: "requesting" | "polling" }) {
  return (
    <div className="fade-in animate-in space-y-3 duration-500">
      <div className="max-w-[85%] rounded-xl rounded-bl-sm bg-white/10 px-4 py-3">
        <p className="text-sm leading-relaxed">
          <span className="font-semibold text-white">
            {state === "requesting"
              ? "Sending authorization request..."
              : "Waiting for your approval to complete the purchase."}
          </span>
        </p>
      </div>

      {state === "polling" && (
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-3">
            <div className="size-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            <div>
              <p className="font-medium text-sm">Approval required</p>
              <p className="text-white/50 text-xs">
                Check your Zentity dashboard or email to approve
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-md bg-white/5 p-3">
            <HugeiconsIcon
              className="mt-0.5 shrink-0 text-white/40"
              icon={InformationCircleIcon}
              size={14}
            />
            <p className="text-white/50 text-xs leading-relaxed">
              Open your{" "}
              <a
                className="text-white/70 underline"
                href={`${env.NEXT_PUBLIC_ZENTITY_URL}/dashboard/ciba`}
                rel="noopener noreferrer"
                target="_blank"
              >
                Zentity Dashboard
              </a>{" "}
              or check your email for the approval notification.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    const payload = parts[1];
    if (parts.length !== 3 || !payload) {
      return null;
    }
    return JSON.parse(atob(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function CibaResult({
  pick,
  onReset,
  tokens,
  exchangedTokens,
  userInfo,
}: {
  exchangedTokens: Record<string, unknown> | null;
  onReset: () => void;
  pick: Product;
  tokens: Record<string, unknown>;
  userInfo: Record<string, unknown> | null;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const orderId = `AE-${Date.now().toString(36).toUpperCase().slice(-6)}`;
  const tax = pick.price * 0.0875;
  const total = pick.price + tax;

  const jwtPayload =
    typeof tokens.access_token === "string"
      ? decodeJwtPayload(tokens.access_token)
      : null;
  const actClaim = jwtPayload?.act as Record<string, unknown> | undefined;
  const agentClaim = jwtPayload?.agent as Record<string, unknown> | undefined;
  const authorizationDetails = tokens.authorization_details as
    | unknown[]
    | undefined;

  // Decode id_token for assurance claims
  const idTokenPayload =
    typeof tokens.id_token === "string"
      ? decodeJwtPayload(tokens.id_token)
      : null;
  const acr = idTokenPayload?.acr as string | undefined;
  const amr = idTokenPayload?.amr as string[] | undefined;

  const exchangedPayload =
    exchangedTokens && typeof exchangedTokens.access_token === "string"
      ? decodeJwtPayload(exchangedTokens.access_token)
      : null;
  const exchangedAct = exchangedPayload?.act as
    | Record<string, unknown>
    | undefined;

  return (
    <div className="fade-in animate-in space-y-3 duration-500">
      <div className="max-w-[85%] rounded-xl rounded-bl-sm bg-white/10 px-4 py-3">
        <p className="text-sm leading-relaxed">
          <span className="font-semibold text-white">
            Authorization received!
          </span>{" "}
          Completing your purchase now.
        </p>
      </div>

      <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-4">
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            className="text-green-400"
            icon={CheckmarkCircle02Icon}
            size={20}
          />
          <p className="font-semibold text-green-400">Purchase Complete</p>
        </div>
        <div className="mt-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-white/60">Order</span>
            <span className="font-mono text-white/80">#{orderId}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-white/60">Item</span>
            <span className="text-white/80">
              {pick.brand} {pick.name}
            </span>
          </div>
          <div className="flex justify-between border-white/10 border-t pt-2 font-medium text-sm">
            <span>Total charged</span>
            <span className="font-mono">${total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 border-dashed bg-white/[0.02] p-4 text-center">
        <p className="font-medium text-white/60 text-xs uppercase tracking-wider">
          Decoupled Authorization
        </p>
        <p className="mt-1.5 text-white/40 text-xs leading-relaxed">
          The agent never handled your credentials. You approved from your own
          device via CIBA, and the agent received only the scoped tokens it
          needed.
          {exchangedTokens &&
            " The token was further narrowed via RFC 8693 Token Exchange before calling the merchant API."}
        </p>
      </div>

      <AssuranceBadges claims={idTokenPayload ?? undefined} />

      {(actClaim || agentClaim || authorizationDetails || exchangedPayload) && (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setShowDetails((prev) => !prev)}
            type="button"
          >
            <span className="font-medium text-white/60 text-xs uppercase tracking-wider">
              Token Details
            </span>
            <span className="text-white/40 text-xs">
              {showDetails ? "Hide" : "Show"}
            </span>
          </button>

          {showDetails && (
            <div className="mt-3 space-y-3">
              {acr && (
                <div>
                  <p className="mb-1 text-white/50 text-xs">
                    ID token — assurance (acr + amr)
                  </p>
                  <pre className="overflow-x-auto rounded-md bg-black/30 p-2 font-mono text-cyan-300/80 text-xs">
                    {JSON.stringify(
                      { acr, acr_eidas: idTokenPayload?.acr_eidas, amr },
                      null,
                      2
                    )}
                  </pre>
                </div>
              )}
              {agentClaim && (
                <div>
                  <p className="mb-1 text-white/50 text-xs">
                    CIBA token — agent claim (AAP identity)
                  </p>
                  <pre className="overflow-x-auto rounded-md bg-black/30 p-2 font-mono text-pink-300/80 text-xs">
                    {JSON.stringify(agentClaim, null, 2)}
                  </pre>
                </div>
              )}
              {actClaim && (
                <div>
                  <p className="mb-1 text-white/50 text-xs">
                    CIBA token — act claim (delegation)
                  </p>
                  <pre className="overflow-x-auto rounded-md bg-black/30 p-2 font-mono text-green-300/80 text-xs">
                    {JSON.stringify(actClaim, null, 2)}
                  </pre>
                </div>
              )}
              {exchangedPayload && (
                <div>
                  <p className="mb-1 text-white/50 text-xs">
                    Exchanged token — act claim (delegation chain)
                  </p>
                  <pre className="overflow-x-auto rounded-md bg-black/30 p-2 font-mono text-amber-300/80 text-xs">
                    {JSON.stringify(exchangedAct, null, 2)}
                  </pre>
                  <p className="mt-1.5 mb-1 text-white/50 text-xs">
                    Exchanged token — audience
                  </p>
                  <pre className="overflow-x-auto rounded-md bg-black/30 p-2 font-mono text-amber-300/80 text-xs">
                    {JSON.stringify(exchangedPayload.aud, null, 2)}
                  </pre>
                  <p className="mt-1.5 mb-1 text-white/50 text-xs">
                    Exchanged token — scope
                  </p>
                  <pre className="overflow-x-auto rounded-md bg-black/30 p-2 font-mono text-amber-300/80 text-xs">
                    {JSON.stringify(exchangedPayload.scope, null, 2)}
                  </pre>
                </div>
              )}
              {authorizationDetails && (
                <div>
                  <p className="mb-1 text-white/50 text-xs">
                    authorization_details (approved action)
                  </p>
                  <pre className="overflow-x-auto rounded-md bg-black/30 p-2 font-mono text-blue-300/80 text-xs">
                    {JSON.stringify(authorizationDetails, null, 2)}
                  </pre>
                </div>
              )}
              {userInfo &&
                Object.keys(userInfo).some(
                  (k) => !["sub", "iss", "aud"].includes(k)
                ) && (
                  <div>
                    <p className="mb-1 text-white/50 text-xs">
                      Userinfo — identity claims (via GET /userinfo)
                    </p>
                    <pre className="overflow-x-auto rounded-md bg-black/30 p-2 font-mono text-purple-300/80 text-xs">
                      {JSON.stringify(userInfo, null, 2)}
                    </pre>
                  </div>
                )}
            </div>
          )}
        </div>
      )}

      <Button
        className="w-full text-white/60"
        onClick={onReset}
        variant="outline"
      >
        Try Another Task
      </Button>
    </div>
  );
}

function CibaOutcome({
  icon,
  iconColor,
  title,
  description,
  onReset,
}: {
  description: string;
  icon: typeof Cancel01Icon;
  iconColor: string;
  onReset: () => void;
  title: string;
}) {
  return (
    <div className="fade-in animate-in space-y-3 duration-500">
      <div className="rounded-lg border border-white/10 bg-white/5 p-4">
        <div className="flex items-center gap-2">
          <HugeiconsIcon className={iconColor} icon={icon} size={20} />
          <p className="font-semibold">{title}</p>
        </div>
        <p className="mt-1 text-sm text-white/60">{description}</p>
      </div>
      <Button
        className="w-full text-white/60"
        onClick={onReset}
        variant="outline"
      >
        Try Again
      </Button>
    </div>
  );
}
