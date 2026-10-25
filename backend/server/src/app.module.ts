import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { ApprovalModule } from '@natural-enforcement/approval';
import { CaseModule } from '@natural-enforcement/case';
import { DeadlineModule } from '@natural-enforcement/deadline';
import { GeoDictModule } from '@natural-enforcement/geo-dict';
import { IdentityModule } from '@natural-enforcement/identity';
import { SupervisionModule } from '@natural-enforcement/supervision';

import { AdminController } from './admin.controller.ts';
import { AdminService } from './admin.service.ts';
import { AuditBrowseService } from './audit-browse.service.ts';
import { AuditController } from './audit.controller.ts';
import { ClueClosureController } from './clue-closure.controller.ts';
import { ClueDesignationController } from './clue-designation.controller.ts';
import { ClueDesignationService } from './clue-designation.service.ts';
import { ClueDispatchController } from './clue-dispatch.controller.ts';
import { ClueClosureService } from './clue-closure.service.ts';
import { ClueDispatchService } from './clue-dispatch.service.ts';
import { ClueDispositionController } from './clue-disposition.controller.ts';
import { ClueDispositionService } from './clue-disposition.service.ts';
import { ClueFormSchemaController } from './clue-form-schema.controller.ts';
import { ClueDuplicateController } from './clue-duplicate.controller.ts';
import { ClueDuplicateService } from './clue-duplicate.service.ts';
import { ClueGeometryController } from './clue-geometry.controller.ts';
import { ClueItemSupplementController } from './clue-item-supplement.controller.ts';
import { ClueRegistrationController } from './clue-registration.controller.ts';
import { ClueSuggestionService } from './clue-suggestion.service.ts';
import { ClueVerificationController } from './clue-verification.controller.ts';
import { ClueWithdrawController } from './clue-withdraw.controller.ts';
import { AuthController } from './auth.controller.ts';
import { AuthService } from './auth.service.ts';
import { ClueFormSchemaService } from './clue-form-schema.service.ts';
import { ClueGeometryService } from './clue-geometry.service.ts';
import { ClueItemSupplementService } from './clue-item-supplement.service.ts';
import { ClueRegistrationService } from './clue-registration.service.ts';
import { ClueVerificationService } from './clue-verification.service.ts';
import { ClueVerificationWorker } from './clue-verification.worker.ts';
import { ClueWithdrawService } from './clue-withdraw.service.ts';
import { HealthController } from './health.controller.ts';
import { OrgUnitsController } from './org-units.controller.ts';
import { OrgUnitsService } from './org-units.service.ts';
import { PersonnelCertController } from './personnel-cert.controller.ts';
import { PersonnelCertsService } from './personnel-cert.service.ts';
import { PersonnelController } from './personnel.controller.ts';
import { PersonnelProfilesService } from './personnel-profiles.service.ts';
import { SessionGuard } from './session.guard.ts';
import { SourceGate } from './source-gate.ts';

/** 启动包装入六个业务模块。它本身不是第七个业务模块。 */
@Module({
  imports: [
    IdentityModule,
    CaseModule,
    ApprovalModule,
    SupervisionModule,
    DeadlineModule,
    GeoDictModule,
  ],
  controllers: [
    HealthController,
    AuthController,
    AdminController,
    OrgUnitsController,
    PersonnelController,
    PersonnelCertController,
    AuditController,
    ClueFormSchemaController,
    ClueRegistrationController,
    ClueItemSupplementController,
    ClueVerificationController,
    ClueGeometryController,
    ClueDuplicateController,
    ClueDispatchController,
    ClueWithdrawController,
    ClueClosureController,
    ClueDispositionController,
    ClueDesignationController,
  ],
  providers: [
    AuthService,
    AdminService,
    OrgUnitsService,
    PersonnelProfilesService,
    PersonnelCertsService,
    AuditBrowseService,
    ClueFormSchemaService,
    ClueRegistrationService,
    ClueItemSupplementService,
    ClueVerificationService,
    ClueSuggestionService,
    ClueDispatchService,
    ClueWithdrawService,
    ClueClosureService,
    ClueDispositionService,
    ClueDesignationService,
    ClueVerificationWorker,
    ClueGeometryService,
    ClueDuplicateService,
    SourceGate,
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
})
export class AppModule {}
