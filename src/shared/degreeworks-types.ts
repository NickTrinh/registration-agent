// Raw shapes for the Fordham DegreeWorks JSON API.
// Implements: ADR 0005, ADR 0006 — see notes/decisions/.
//
// These mirror the live response captured 2026-04-14 and documented in
// notes/degreeworks-api-reference.md. All numeric fields are string-encoded
// in the wire format (Ellucian habit) — we do NOT coerce them here.
// Dispatch on symbolic fields (`ruleType`, `qualifier.name`) and ignore the
// numeric `nodeType` mirror.

// ─── /api/students/myself ─────────────────────────────────────────────────────

export interface StudentsMyself {
  _embedded: { students: Student[] };
  page: { size: string; totalElements: string; totalPages: string; number: string };
}

export interface Student {
  id: string;                     // "A20000000"
  name: string;                   // "Student, Sample A."
  activeTerm: string;             // "202620" (Banner term code)
  bridgeRefresh: { date: string; time: string };
  bridgeChanged: { date: string; time: string };
  goals: StudentGoal[];
  custom: CustomAttribute[];
}

export interface StudentGoal {
  school: KeyDesc;                // { key: "U", description: "Undergraduate" }
  degree: KeyDesc;                // { key: "BS", description: "Bachelor Of Science" }
  level: KeyDesc;                 // { key: "SR", description: "Senior" }
  catalogYear: KeyDesc;           // { key: "2024", description: "2023-2024" }
  studyPathId: KeyDesc;
  details: GoalDetail[];
}

export interface GoalDetail {
  code: KeyDesc;                  // "COLLEGE" | "PROGRAM" | "CONC" | "MAJOR"
  value: KeyDesc;
}

export interface KeyDesc {
  key: string;
  description: string;
}

export interface CustomAttribute {
  code: string;                   // "GPACREDITSOV" | "ADVDISP" | "CAMPDESC" | "GRADDATE" | "TRANSFERHRS" | ""
  value: string;
  school?: string;
  degree?: string;
}

// ─── /api/audit (GET regular, POST What-If) ───────────────────────────────────

export interface AuditResponse {
  auditHeader: AuditHeader;
  blockArray: AuditBlock[];
  classInformation: ClassInformation;
  fallThrough: ClassBucket;
  overTheLimit: ClassBucket;
  insufficient: InsufficientBucket;
  inProgress: ClassBucket;
  fitList: FitList;
  splitCredits: { classes: string; credits: string };
  degreeInformation: DegreeInformation;
  exceptionList: ExceptionList;
  notes: Record<string, unknown>;
  flags: Record<string, string>;
}

export interface AuditHeader {
  auditId: string;
  studentId: string;
  auditType: string;              // "AA"
  studentName: string;
  studentEmail: string;
  freezeType: string;
  freezeTypeDescription: string;
  freezeDate: string;
  freezeUserName: string;
  auditDescription: string;
  dateYear: string;
  dateMonth: string;
  dateDay: string;
  timeHour: string;
  timeMinute: string;
  studentSystemGpa: string;
  degreeworksGpa: string;
  percentComplete: string;        // "85"
  version: string;
  inProgress: "Y" | "N";
  whatIf: "Y" | "N";
  residentApplied: string;
  residentAppliedInProgress: string;
  transferApplied: string;
  examAppliedCredits: string;
  residentOverTheLimit: string;
  residentOverTheLimitInProgress: string;
  transferOverTheLimit: string;
  examOverTheLimit: string;
}

export interface AuditBlock {
  requirementId: string;          // "RA000115"
  requirementType: string;        // "DEGREE" | "MAJOR" | "MINOR" | "CORE" | ...
  requirementValue: string;
  title: string;
  percentComplete: string;
  catalogYearStart: string;
  catalogYearStop: string;
  catalogYear: string;
  catalogYearLit: string;         // "2023-2024"
  degree: string;
  college: string;
  gpa: string;
  classesApplied: string;
  creditsApplied: string;
  gpaGradePoints: string;
  gpaCredits: string;
  header: BlockHeader;
  ruleArray: AuditRule[];
}

export interface BlockHeader {
  qualifierArray: Qualifier[];
  remark: { textList: string[] };
  display: { textArray: Array<{ lineList: string[] }> };
  advice: {
    textArray: Array<{
      nodeId: string;
      lineList: string[];
    }>;
  };
}

export interface Qualifier {
  nodeId: string;
  nodeType: string;
  satisfied?: "Yes" | "No" | "Inprogress";
  applied?: string;
  needed?: string;
  name: string;                   // "MINRES" | "MINCLASS" | "CLASSESCREDITS" | ...
  classes?: string;
  credits?: string;
  label?: string;
  labelTag?: string;
  text: string;
  subTextList?: string[];
  code?: string;                  // HEADERTAG
  value?: string;                 // HEADERTAG
  tag?: string;                   // MAXCLASS policy keys (e.g. "NoPFCOVID")
  minGPA?: string;
  maxGPA?: string;
  minGrade?: string;
  classesApplied?: string;
  creditsApplied?: string;
}

export type RuleType = "Complete" | "Block" | "Blocktype" | "Course" | "Group" | "Subset";

export interface AuditRule {
  label: string;
  labelTag: string;
  percentComplete: string;
  ruleId: string;                 // dotted path "1-0"
  nodeId: string;
  nodeType: string;               // mirror — dispatch on ruleType instead
  indentLevel: string;
  ruleType: RuleType;
  ifElsePart?: "IfPart" | "ElsePart";
  inProgressIncomplete?: "Yes";
  subruleIncomplete?: "Yes";
  lastRuleInGroup?: "Yes";
  remark?: { textList: string[] };
  classesApplied?: string;
  creditsApplied?: string;
  classesAppliedToRule?: ClassesAppliedToRule;
  requirement: Requirement;
  advice?: RuleAdvice;
  ruleArray?: AuditRule[];
}

export interface ClassesAppliedToRule {
  classArray?: AppliedClass[];
}

export interface AppliedClass {
  discipline: string;             // "ENGL"
  number: string;                 // "1102"
  credits: string;
  letterGrade: string;            // "", "A", "A-", "TB"
  id: string;
  term: string;                   // "202410"
}

export interface Requirement {
  classesBegin?: string;
  creditsBegin?: string;
  classCreditOperator: "OR" | "AND";
  connector: "," | "AND" | "";
  decide?: "LOWTERM" | string;
  courseArray: CourseMatcher[];
  except?: { courseArray: CourseMatcher[] };
  qualifierArray?: Qualifier[];
  // Block / Blocktype fields
  numBlocks?: string;
  numBlocktypes?: string;
  type?: string;                  // "OTHER" | "MAJOR" | "MINOR" | "CORE"
  value?: string;                 // "CORE" | "PREHEALTH"
  // Group fields
  numberOfGroups?: string;
  numberOfRules?: string;
}

export interface CourseMatcher {
  discipline: string;             // "ENGL" | "@"
  number: string;                 // "1102" | "@"
  numberEnd?: string;
  nodeId: string;
  newDiscipline?: "Yes";
  hideFromAdvice?: "Yes";
  withArray?: WithClause[];
}

export interface WithClause {
  code: "ATTRIBUTE" | "DWCREDITS" | "DWTERM" | "DWPASSFAIL" | "DWSCHOOL" | "DWINPROGRESS" | string;
  operator: "=" | ">=" | "<=" | "<>" | ">";
  connector: "" | "AND" | "OR";
  valueList: string[];
}

export interface RuleAdvice {
  classes?: string;
  connector?: string;
  courseArray?: Array<CourseMatcher & {
    title?: string;
    credits?: string;
    prerequisiteExists?: "Y" | "N";
    withAdvice?: string;
  }>;
  except?: { courseArray: CourseMatcher[] };
  titleList?: string[];
  blockId?: string;
}

// ─── Class history buckets ────────────────────────────────────────────────────

export interface ClassInformation {
  classArray: TakenClass[];
}

export interface ClassBucket {
  classes: string;
  credits: string;
  noncourses?: string;
  classArray: TakenClass[];
}

export interface InsufficientBucket {
  classes: string;
  credits: string;
  classArray: InsufficientClass[];
}

export interface TakenClass {
  discipline: string;
  number: string;
  credits: string;
  letterGrade: string;
  id: string;
  term: string;
  courseTitle: string;
  termLiteral: string;
  termLiteralLong: string;
  recordType: string;             // "Course" | "Transfer" | ...
  status: string;
  studentSystemCredits: string;
  inProgress: "Y" | "N";
  preregistered: "Y" | "N";
  passed: "Y" | "N";
  passfail: "Y" | "N";
  incomplete: "Y" | "N";
  atCode?: string;
  gradePoints: string;
  numericGrade: string;
  gpaGradePoints: string;
  gpaCredits: string;
  section: string;
  school: string;
  gradeType: string;
  repeatDiscipline?: string;
  repeatNumber?: string;
  repeatPolicy?: string;
  transfer: "Y" | "N";
  transferCode?: string;
  transferType?: string;
  partTerm?: string;
  equivalenceExists: "Y" | "N";
  locArray: ClassLocation[];
  attributeArray: ClassAttribute[];
}

export interface InsufficientClass extends TakenClass {
  reasonInsufficient: "FA" | "WD" | string;
  forceInsufficient?: "Y" | "N";
}

export interface ClassLocation {
  requirementId: string;
  nodeLocation: string;
  level: string;
  headerFit: "Y" | "N";
  qualifierNodeLocation?: string;
  rank: string;
  reasonRemoved?: string;
  inGroup: "Y" | "N";
}

export interface ClassAttribute {
  DWSISKEY: string;
  ATTRIBUTE: string;
}

// ─── FitList (fit-assignment decision trace) ──────────────────────────────────

export interface FitList {
  classArray: FitClass[];
}

export interface FitClass {
  discipline: string;
  number: string;
  term: string;
  rank: string;
  rankReason: string;
  [extra: string]: unknown;       // same identity fields as TakenClass, loose
}

// ─── degreeInformation ────────────────────────────────────────────────────────

export interface DegreeInformation {
  degreeDataArray: DegreeData[];
  goalArray: Goal[];
}

export interface DegreeData {
  degree: string;
  school: string;
  catalogYear: string;
  activeTerm: string;
  studentLevel: string;
  degreeTerm: string;
  studentSystemCumulativeGradedCreditsAttempted: string;
  studentSystemCumulativeGradePointsEarned: string;
  studentSystemCumulativeGpa: string;
  studentSystemCumulativeTotalCreditsEarned: string;
  studentSystemCumulativeCreditsEarned: string;
  degreeSource: string;
  degreeLiteral: string;
  schoolLiteral: string;
  studentLevelLiteral: string;
  catalogYearLit: string;
  activeTermLiteral: string;
}

export interface Goal {
  code: "COLLEGE" | "CONC" | "MAJOR" | "PROGRAM" | "ADVISOR" | string;
  value: string;
  valueLiteral: string;
  catalogYear?: string;
  // ADVISOR goals only
  attachCode?: "ACAD" | "MAJR";
  attachValue?: string;
  advisorName?: string;
  advisorEmail?: string;
}

// ─── exceptionList ────────────────────────────────────────────────────────────

export interface ExceptionList {
  exceptionArray: Exception[];
}

export interface Exception {
  id: string;
  type: string;
  label: string;
  requirementId: string;
  nodeType: string;
  enforced: "Yes" | "No";
  reason: string;
  remark: string;
  applyStatus: "AP" | "UN" | string;
  labelTag: string;
  school: string;
  degree: string;
  date: string;                   // YYYYMMDD
  who: string;
  whoEmail: string;
}

// ─── What-If request body ─────────────────────────────────────────────────────

export interface WhatIfGoal {
  // NB: "CONC" not "CONCENTRATION" — confirmed via cURL capture of the
  // native DegreeWorks UI on 2026-04-19. The server rejects "CONCENTRATION"
  // even though it's the descriptive name elsewhere in the API response.
  code: "MAJOR" | "MINOR" | "COLLEGE" | "CONC" | "DEGREE" | "PROGRAM";
  value: string;
  catalogYear?: string;
}

export interface WhatIfRequest {
  studentId: string;
  isIncludeInprogress: boolean;
  isIncludePreregistered: boolean;
  isKeepCurriculum: boolean;
  school: string;
  degree: string;
  catalogYear: string;
  goals: Array<{ code: string; value: string; catalogYear: string }>;
  classes: Array<{ discipline: string; number: string }>;
}
