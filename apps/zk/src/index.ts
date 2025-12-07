/**
 * ZK Service - Zero-Knowledge Proof HTTP API
 *
 * Provides endpoints for generating and verifying Groth16 proofs
 * using snarkjs for age verification.
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import { proofRouter } from "./routes/proof.js";
import { verifyRouter } from "./routes/verify.js";
import { facematchRouter } from "./routes/facematch.js";
import { docvalidityRouter } from "./routes/docvalidity.js";
import { nationalityRouter } from "./routes/nationality.js";

const app = express();
const PORT = process.env.PORT || 5002;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "zk-service",
  });
});

// Routes
app.use("/generate-proof", proofRouter);
app.use("/verify-proof", verifyRouter);
app.use("/facematch", facematchRouter);
app.use("/docvalidity", docvalidityRouter);
app.use("/nationality", nationalityRouter);

// Error handling
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("Error:", err.message);
    res.status(500).json({
      error: err.message || "Internal server error",
    });
  }
);

// Start server
app.listen(PORT, () => {
  console.log(`ZK Service listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
