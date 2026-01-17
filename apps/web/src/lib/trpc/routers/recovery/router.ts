import "server-only";

import { router } from "../../server";
import {
  approveGuardianProcedure,
  finalizeProcedure,
  startProcedure,
  statusProcedure,
} from "./challenge";
import {
  configProcedure,
  identifierProcedure,
  publicKeyProcedure,
  setupProcedure,
} from "./config";
import {
  addGuardianEmailProcedure,
  addGuardianTwoFactorProcedure,
  listGuardiansProcedure,
  removeGuardianProcedure,
  storeSecretWrapperProcedure,
  wrappersStatusProcedure,
} from "./guardian";

export const recoveryRouter = router({
  publicKey: publicKeyProcedure,
  config: configProcedure,
  identifier: identifierProcedure,
  setup: setupProcedure,
  listGuardians: listGuardiansProcedure,
  removeGuardian: removeGuardianProcedure,
  addGuardianEmail: addGuardianEmailProcedure,
  addGuardianTwoFactor: addGuardianTwoFactorProcedure,
  wrappersStatus: wrappersStatusProcedure,
  storeSecretWrapper: storeSecretWrapperProcedure,
  start: startProcedure,
  status: statusProcedure,
  approveGuardian: approveGuardianProcedure,
  finalize: finalizeProcedure,
});
