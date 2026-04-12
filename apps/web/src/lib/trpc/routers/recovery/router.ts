import "server-only";

import { router } from "../../server";
import {
  approveGuardianProcedure,
  finalizeProcedure,
  recoverDekProcedure,
  startProcedure,
  statusProcedure,
} from "./challenge";
import {
  addGuardianCustodialEmailProcedure,
  addGuardianEmailProcedure,
  addGuardianTwoFactorProcedure,
  listGuardiansProcedure,
  removeGuardianProcedure,
  storeSecretWrapperProcedure,
  wrappersStatusProcedure,
} from "./guardian";
import {
  configProcedure,
  identifierProcedure,
  publicKeyProcedure,
  setupProcedure,
} from "./procedures";

export const recoveryRouter = router({
  publicKey: publicKeyProcedure,
  config: configProcedure,
  identifier: identifierProcedure,
  setup: setupProcedure,
  listGuardians: listGuardiansProcedure,
  removeGuardian: removeGuardianProcedure,
  addGuardianEmail: addGuardianEmailProcedure,
  addGuardianTwoFactor: addGuardianTwoFactorProcedure,
  addGuardianCustodialEmail: addGuardianCustodialEmailProcedure,
  wrappersStatus: wrappersStatusProcedure,
  storeSecretWrapper: storeSecretWrapperProcedure,
  start: startProcedure,
  status: statusProcedure,
  approveGuardian: approveGuardianProcedure,
  recoverDek: recoverDekProcedure,
  finalize: finalizeProcedure,
});
