/**
 * The landing page's sections. The app's `/` route wires them to the setup
 * flow; see apps/web/src/routes/index.tsx. Styles: `@goblins/ui/landing.css`.
 */
export { UPLOAD_PROBLEM_COPY } from "./copy";
export { DropZone, type DropZoneProps, type DropZoneState } from "./DropZone";
export { GradedWorksheet } from "./GradedWorksheet";
export { LandingPage, type LandingPageProps } from "./LandingPage";
export { TemplatePicker, type TemplatePickerProps } from "./TemplatePicker";
export { TEMPLATE_SUMMARIES, type TemplateSummary, toSummary } from "./templates";
export {
  ACCEPT_ATTRIBUTE,
  checkFiles,
  type FileCheck,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  type UploadProblem,
  type UploadResult,
} from "./upload";
