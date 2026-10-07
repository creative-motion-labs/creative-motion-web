/**
 * Supabase Database types for the RASQ `public` schema.
 *
 * ── Regeneration ────────────────────────────────────────────────────────────
 *
 * Preferred (live project — produces the canonical file):
 *
 *   1. Log in once:
 *        npx supabase login
 *
 *   2. Set your project ref (Dashboard → Project Settings → General):
 *        $env:SUPABASE_PROJECT_REF = "<your-project-ref>"   # PowerShell
 *        export SUPABASE_PROJECT_REF="<your-project-ref>"    # bash
 *
 *   3. Regenerate this file:
 *        npx supabase gen types typescript --project-id $env:SUPABASE_PROJECT_REF | Out-File -Encoding utf8 app/lib/supabase/database.types.ts
 *
 *      bash/zsh equivalent:
 *        npx supabase gen types typescript --project-id "$SUPABASE_PROJECT_REF" > app/lib/supabase/database.types.ts
 *
 *   If the repo is linked via `npx supabase link --project-ref <ref>`:
 *        npx supabase gen types typescript --linked > app/lib/supabase/database.types.ts
 *
 * Fallback (no live DB — hand-sync from SQL):
 *   Update this file to match supabase/migrations/001–012 and schema.sql after
 *   every new migration. Run `npm run build` and fix any row-type overlays in
 *   app/api/plans/route.ts and app/api/assessments/route.ts.
 *
 * Sprint 1 D1: initial file hand-synced from migrations 001–010 + schema.sql.
 * Sprint 1 D2: ai_clinician_summaries added (migration 011).
 * Speech AI S1: speech_transcription_sessions added (migration 012).
 * PR 6 prep: regenerated via `npx supabase gen types typescript --linked`
 * against Staging (000–016 applied) to pick up the rehabilitation catalog
 * tables from migrations 014–016 (rehabilitation_conditions,
 * rehabilitation_pathways, treatment_programs, program_sessions,
 * program_session_blocks), which had never been reflected here before.
 * The generator's own `Tables<T>`/`TablesInsert<T>`/etc. helper block was
 * NOT kept — this file's own hand-maintained `Tables<T>` shorthand and
 * per-table Row aliases below are what the rest of the app actually
 * imports (e.g. app/api/plans/route.ts's `TreatmentPlansRow`); replacing
 * them would have been a wide, unrelated break. Only the generated
 * `Database` type body itself was refreshed.
 * PR 6: regenerated again via `npx supabase gen types typescript --linked`
 * against Staging after migration 017 was applied there. This adds
 * treatment_plans.source_treatment_program_id and
 * plan_sessions.source_program_session_id (both `string | null`, with
 * their FK relationships to treatment_programs/program_sessions) to the
 * generated Database type body below. No other change — the same
 * hand-maintained `Tables<T>` shorthand and Row aliases from the prior
 * regeneration are unchanged, and no new Row alias was needed since
 * TreatmentPlansRow/PlanSessionsRow already existed.
 * PR 7: regenerated again via `npx supabase gen types typescript --linked`
 * against Staging after migration 018 was applied there. This adds
 * treatment_plans.catalog_assignment_request_id (`string | null`) and a
 * typed Functions entry for create_plan_from_catalog_program (all six
 * arguments, JSON return type) to the generated Database type body
 * below. No existing table, relationship, helper, or alias was
 * removed — the same hand-maintained `Tables<T>` shorthand and Row
 * aliases from the prior regeneration are unchanged, and no new Row
 * alias was needed since TreatmentPlansRow already existed.
 * Upper-limb persistence API prep: full regeneration via
 * `npx supabase gen types typescript --project-id <staging-ref>` was
 * attempted against Staging (000–020 applied) but rejected after
 * inspection — Staging now also has an out-of-band
 * upper_limb_motor_screen_clinician_reviews table and a
 * rehab_catalog_program_status_for_session function that neither this
 * repo's migrations nor any prior task created, and the full
 * regenerated file replaces the entire Database body wholesale
 * (2500+ line diff) rather than a scoped addition. Both are unrelated
 * to migrations 019/020 and out of scope here, so per the hand-sync
 * fallback only upper_limb_motor_screen_assignments and
 * upper_limb_motor_screen_session_results were added below, hand-typed
 * from the same live Staging introspection output (which also
 * confirms migration 020 applied to Staging exactly as written: both
 * tables' shapes match 019/020 exactly, including the nullable
 * legacy-only assignment columns and the required, no-default id on
 * both tables). No existing table, relationship, helper, or alias was
 * changed.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_clinician_summaries: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approved_text: string | null
          created_at: string
          draft_text: string
          id: string
          inputs_snapshot: Json
          patient_id: string
          plan_id: string | null
          provider_id: string
          schema_version: string
          status: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approved_text?: string | null
          created_at?: string
          draft_text: string
          id?: string
          inputs_snapshot: Json
          patient_id: string
          plan_id?: string | null
          provider_id: string
          schema_version: string
          status?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approved_text?: string | null
          created_at?: string
          draft_text?: string
          id?: string
          inputs_snapshot?: Json
          patient_id?: string
          plan_id?: string | null
          provider_id?: string
          schema_version?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_clinician_summaries_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_clinician_summaries_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_clinician_summaries_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "treatment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_clinician_summaries_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      assessments: {
        Row: {
          body_region: string | null
          completed_at: string | null
          created_at: string
          duration_seconds: number | null
          id: string
          metrics: Json | null
          mode: string
          notes: string | null
          patient_id: string
          provider_id: string | null
          score: number | null
          selected_tests: string[]
          session_label: string | null
          side: string | null
          status: string
          structured_data: Json | null
          summary: string | null
          type: string
          updated_at: string
          visit_type: string | null
        }
        Insert: {
          body_region?: string | null
          completed_at?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          metrics?: Json | null
          mode: string
          notes?: string | null
          patient_id: string
          provider_id?: string | null
          score?: number | null
          selected_tests?: string[]
          session_label?: string | null
          side?: string | null
          status?: string
          structured_data?: Json | null
          summary?: string | null
          type?: string
          updated_at?: string
          visit_type?: string | null
        }
        Update: {
          body_region?: string | null
          completed_at?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          metrics?: Json | null
          mode?: string
          notes?: string | null
          patient_id?: string
          provider_id?: string | null
          score?: number | null
          selected_tests?: string[]
          session_label?: string | null
          side?: string | null
          status?: string
          structured_data?: Json | null
          summary?: string | null
          type?: string
          updated_at?: string
          visit_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_review_acknowledgments: {
        Row: {
          action_status: string
          created_at: string
          id: string
          patient_id: string
          plan_id: string
          provider_id: string
          review_note: string | null
          reviewed_at: string
          reviewed_by: string
          session_log_id: string | null
          trigger_key: string
        }
        Insert: {
          action_status: string
          created_at?: string
          id?: string
          patient_id: string
          plan_id: string
          provider_id: string
          review_note?: string | null
          reviewed_at?: string
          reviewed_by: string
          session_log_id?: string | null
          trigger_key: string
        }
        Update: {
          action_status?: string
          created_at?: string
          id?: string
          patient_id?: string
          plan_id?: string
          provider_id?: string
          review_note?: string | null
          reviewed_at?: string
          reviewed_by?: string
          session_log_id?: string | null
          trigger_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_review_acknowledgments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_review_acknowledgments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "treatment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_review_acknowledgments_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_review_acknowledgments_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_review_acknowledgments_session_log_id_fkey"
            columns: ["session_log_id"]
            isOneToOne: false
            referencedRelation: "session_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      cv_session_metrics: {
        Row: {
          exercise_id: string
          frames_total: number | null
          frames_with_pose: number | null
          id: string
          motion_quality: Json | null
          movement_detected: boolean
          patient_id: string | null
          plan_id: string | null
          plan_session_id: string | null
          prototype_version: string
          provider_id: string
          recorded_at: string
          rep_count: number | null
          session_duration_s: number | null
          source: string
          tracking_quality: string | null
        }
        Insert: {
          exercise_id: string
          frames_total?: number | null
          frames_with_pose?: number | null
          id?: string
          motion_quality?: Json | null
          movement_detected?: boolean
          patient_id?: string | null
          plan_id?: string | null
          plan_session_id?: string | null
          prototype_version?: string
          provider_id: string
          recorded_at?: string
          rep_count?: number | null
          session_duration_s?: number | null
          source?: string
          tracking_quality?: string | null
        }
        Update: {
          exercise_id?: string
          frames_total?: number | null
          frames_with_pose?: number | null
          id?: string
          motion_quality?: Json | null
          movement_detected?: boolean
          patient_id?: string | null
          plan_id?: string | null
          plan_session_id?: string | null
          prototype_version?: string
          provider_id?: string
          recorded_at?: string
          rep_count?: number | null
          session_duration_s?: number | null
          source?: string
          tracking_quality?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cv_session_metrics_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cv_session_metrics_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "treatment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cv_session_metrics_plan_session_id_fkey"
            columns: ["plan_session_id"]
            isOneToOne: false
            referencedRelation: "plan_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cv_session_metrics_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      interactive_shoulder_movement_outcomes: {
        Row: {
          created_at: string
          id: string
          outcome_payload: Json
          plan_id: string
          plan_session_id: string | null
          prescribed_side: string | null
          provider_id: string
          patient_id: string
          schema_version: string
          session_state: string
        }
        Insert: {
          created_at?: string
          id?: string
          outcome_payload: Json
          plan_id: string
          plan_session_id?: string | null
          prescribed_side?: string | null
          provider_id: string
          patient_id: string
          schema_version: string
          session_state: string
        }
        Update: {
          created_at?: string
          id?: string
          outcome_payload?: Json
          plan_id?: string
          plan_session_id?: string | null
          prescribed_side?: string | null
          provider_id?: string
          patient_id?: string
          schema_version?: string
          session_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "interactive_shoulder_movement_outcomes_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "treatment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactive_shoulder_movement_outcomes_plan_session_id_fkey"
            columns: ["plan_session_id"]
            isOneToOne: true
            referencedRelation: "plan_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactive_shoulder_movement_outcomes_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactive_shoulder_movement_outcomes_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_access_tokens: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          patient_id: string
          patient_name: string
          plan_id: string
          provider_id: string
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          patient_id: string
          patient_name: string
          plan_id: string
          provider_id: string
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          patient_id?: string
          patient_name?: string
          plan_id?: string
          provider_id?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_access_tokens_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_access_tokens_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "treatment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_access_tokens_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          age: number | null
          created_at: string
          diagnosis: string | null
          file_number: string | null
          full_name: string
          gender: string | null
          id: string
          phone: string
          provider_id: string
          sport: string | null
          status: string
          updated_at: string
        }
        Insert: {
          age?: number | null
          created_at?: string
          diagnosis?: string | null
          file_number?: string | null
          full_name: string
          gender?: string | null
          id?: string
          phone: string
          provider_id: string
          sport?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          age?: number | null
          created_at?: string
          diagnosis?: string | null
          file_number?: string | null
          full_name?: string
          gender?: string | null
          id?: string
          phone?: string
          provider_id?: string
          sport?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_sessions: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          exercises: Json
          id: string
          patient_id: string
          plan_id: string
          prescribed_side: string | null
          provider_id: string
          scheduled_at: string | null
          session_number: number
          source_program_session_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          exercises?: Json
          id?: string
          patient_id: string
          plan_id: string
          prescribed_side?: string | null
          provider_id: string
          scheduled_at?: string | null
          session_number: number
          source_program_session_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          exercises?: Json
          id?: string
          patient_id?: string
          plan_id?: string
          prescribed_side?: string | null
          provider_id?: string
          scheduled_at?: string | null
          session_number?: number
          source_program_session_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_sessions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_sessions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "treatment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_sessions_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_sessions_source_program_session_id_fkey"
            columns: ["source_program_session_id"]
            isOneToOne: false
            referencedRelation: "program_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      program_session_blocks: {
        Row: {
          block_key: string
          block_order: number
          block_type: string
          created_at: string
          feedback_profile: string | null
          id: string
          instructions: string
          movement_id: string | null
          program_session_id: string
          target_duration_seconds: number
          title: string
          updated_at: string
        }
        Insert: {
          block_key: string
          block_order: number
          block_type: string
          created_at?: string
          feedback_profile?: string | null
          id?: string
          instructions: string
          movement_id?: string | null
          program_session_id: string
          target_duration_seconds: number
          title: string
          updated_at?: string
        }
        Update: {
          block_key?: string
          block_order?: number
          block_type?: string
          created_at?: string
          feedback_profile?: string | null
          id?: string
          instructions?: string
          movement_id?: string | null
          program_session_id?: string
          target_duration_seconds?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_session_blocks_program_session_id_fkey"
            columns: ["program_session_id"]
            isOneToOne: false
            referencedRelation: "program_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      program_sessions: {
        Row: {
          created_at: string
          estimated_duration_minutes_max: number
          estimated_duration_minutes_min: number
          goal: string
          id: string
          requires_calibration: boolean
          session_key: string
          session_number: number
          summary_mode: string
          title: string
          treatment_program_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          estimated_duration_minutes_max: number
          estimated_duration_minutes_min: number
          goal: string
          id?: string
          requires_calibration?: boolean
          session_key: string
          session_number: number
          summary_mode?: string
          title: string
          treatment_program_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          estimated_duration_minutes_max?: number
          estimated_duration_minutes_min?: number
          goal?: string
          id?: string
          requires_calibration?: boolean
          session_key?: string
          session_number?: number
          summary_mode?: string
          title?: string
          treatment_program_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_sessions_treatment_program_id_fkey"
            columns: ["treatment_program_id"]
            isOneToOne: false
            referencedRelation: "treatment_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          clinic_name: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          role: string
          updated_at: string
        }
        Insert: {
          clinic_name?: string | null
          created_at?: string
          email?: string | null
          id: string
          name: string
          role?: string
          updated_at?: string
        }
        Update: {
          clinic_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      rehabilitation_conditions: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      rehabilitation_pathways: {
        Row: {
          condition_id: string
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          condition_id: string
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          condition_id?: string
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rehabilitation_pathways_condition_id_fkey"
            columns: ["condition_id"]
            isOneToOne: false
            referencedRelation: "rehabilitation_conditions"
            referencedColumns: ["id"]
          },
        ]
      }
      remote_assessment_requests: {
        Row: {
          assessment_id: string | null
          assessment_type: string
          created_at: string
          expires_at: string
          id: string
          included_sections: Json | null
          patient_id: string
          provider_id: string
          status: string
          submitted_at: string | null
          token: string
        }
        Insert: {
          assessment_id?: string | null
          assessment_type?: string
          created_at?: string
          expires_at?: string
          id?: string
          included_sections?: Json | null
          patient_id: string
          provider_id: string
          status?: string
          submitted_at?: string | null
          token: string
        }
        Update: {
          assessment_id?: string | null
          assessment_type?: string
          created_at?: string
          expires_at?: string
          id?: string
          included_sections?: Json | null
          patient_id?: string
          provider_id?: string
          status?: string
          submitted_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "remote_assessment_requests_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remote_assessment_requests_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remote_assessment_requests_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      session_logs: {
        Row: {
          completed_at: string
          created_at: string
          effort_score: number | null
          exercises_completed: number
          id: string
          notes: string | null
          pain_score: number | null
          patient_id: string
          patient_token: string
          plan_id: string
          plan_session_id: string | null
          provider_id: string
        }
        Insert: {
          completed_at?: string
          created_at?: string
          effort_score?: number | null
          exercises_completed?: number
          id?: string
          notes?: string | null
          pain_score?: number | null
          patient_id: string
          patient_token: string
          plan_id: string
          plan_session_id?: string | null
          provider_id: string
        }
        Update: {
          completed_at?: string
          created_at?: string
          effort_score?: number | null
          exercises_completed?: number
          id?: string
          notes?: string | null
          pain_score?: number | null
          patient_id?: string
          patient_token?: string
          plan_id?: string
          plan_session_id?: string | null
          provider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_logs_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "treatment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_logs_plan_session_id_fkey"
            columns: ["plan_session_id"]
            isOneToOne: false
            referencedRelation: "plan_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_logs_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      speech_transcription_sessions: {
        Row: {
          assessment_id: string | null
          byte_size: number | null
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          external_job_id: string | null
          id: string
          language_code: string
          patient_id: string | null
          provider_id: string | null
          provider_name: string
          remote_request_id: string | null
          schema_version: string
          source: string
          status: string
          transcript_text: string | null
        }
        Insert: {
          assessment_id?: string | null
          byte_size?: number | null
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          external_job_id?: string | null
          id?: string
          language_code: string
          patient_id?: string | null
          provider_id?: string | null
          provider_name: string
          remote_request_id?: string | null
          schema_version: string
          source: string
          status?: string
          transcript_text?: string | null
        }
        Update: {
          assessment_id?: string | null
          byte_size?: number | null
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          external_job_id?: string | null
          id?: string
          language_code?: string
          patient_id?: string | null
          provider_id?: string | null
          provider_name?: string
          remote_request_id?: string | null
          schema_version?: string
          source?: string
          status?: string
          transcript_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "speech_transcription_sessions_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speech_transcription_sessions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speech_transcription_sessions_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speech_transcription_sessions_remote_request_id_fkey"
            columns: ["remote_request_id"]
            isOneToOne: false
            referencedRelation: "remote_assessment_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_plans: {
        Row: {
          assessment_id: string | null
          catalog_assignment_request_id: string | null
          clinician_note: string | null
          created_at: string
          current_week: number
          diagnosis: string | null
          id: string
          patient_id: string
          phase: number
          provider_id: string
          source_treatment_program_id: string | null
          status: string
          structured_data: Json | null
          title: string
          total_weeks: number
          updated_at: string
        }
        Insert: {
          assessment_id?: string | null
          catalog_assignment_request_id?: string | null
          clinician_note?: string | null
          created_at?: string
          current_week?: number
          diagnosis?: string | null
          id?: string
          patient_id: string
          phase?: number
          provider_id: string
          source_treatment_program_id?: string | null
          status?: string
          structured_data?: Json | null
          title: string
          total_weeks?: number
          updated_at?: string
        }
        Update: {
          assessment_id?: string | null
          catalog_assignment_request_id?: string | null
          clinician_note?: string | null
          created_at?: string
          current_week?: number
          diagnosis?: string | null
          id?: string
          patient_id?: string
          phase?: number
          provider_id?: string
          source_treatment_program_id?: string | null
          status?: string
          structured_data?: Json | null
          title?: string
          total_weeks?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "treatment_plans_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plans_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plans_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plans_source_treatment_program_id_fkey"
            columns: ["source_treatment_program_id"]
            isOneToOne: false
            referencedRelation: "treatment_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_programs: {
        Row: {
          created_at: string
          id: string
          name: string
          pathway_id: string
          slug: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          pathway_id: string
          slug: string
          status?: string
          updated_at?: string
          version: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          pathway_id?: string
          slug?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "treatment_programs_pathway_id_fkey"
            columns: ["pathway_id"]
            isOneToOne: false
            referencedRelation: "rehabilitation_pathways"
            referencedColumns: ["id"]
          },
        ]
      }
      upper_limb_motor_screen_assignments: {
        Row: {
          affected_side: string | null
          assigned_at: string | null
          assignment_payload: Json
          assignment_request_id: string | null
          assignment_request_payload_hash: string | null
          created_at: string
          delivery_mode: string | null
          id: string
          patient_id: string
          provider_id: string
          schema_version: string
          screen_definition_id: string | null
          status: string
          token_expires_at: string | null
          token_hash: string | null
          updated_at: string
        }
        Insert: {
          affected_side?: string | null
          assigned_at?: string | null
          assignment_payload: Json
          assignment_request_id?: string | null
          assignment_request_payload_hash?: string | null
          created_at?: string
          delivery_mode?: string | null
          id: string
          patient_id: string
          provider_id: string
          schema_version: string
          screen_definition_id?: string | null
          status: string
          token_expires_at?: string | null
          token_hash?: string | null
          updated_at?: string
        }
        Update: {
          affected_side?: string | null
          assigned_at?: string | null
          assignment_payload?: Json
          assignment_request_id?: string | null
          assignment_request_payload_hash?: string | null
          created_at?: string
          delivery_mode?: string | null
          id?: string
          patient_id?: string
          provider_id?: string
          schema_version?: string
          screen_definition_id?: string | null
          status?: string
          token_expires_at?: string | null
          token_hash?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "upper_limb_motor_screen_assignments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upper_limb_motor_screen_assignments_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      upper_limb_motor_screen_session_results: {
        Row: {
          assignment_id: string
          created_at: string
          id: string
          overall_quality: string
          patient_id: string
          protective_pause_count: number
          protective_pause_duration_ms_total: number
          provider_id: string
          result_payload: Json
          schema_version: string
          status: string
          updated_at: string
        }
        Insert: {
          assignment_id: string
          created_at?: string
          id: string
          overall_quality: string
          patient_id: string
          protective_pause_count: number
          protective_pause_duration_ms_total: number
          provider_id: string
          result_payload: Json
          schema_version: string
          status?: string
          updated_at?: string
        }
        Update: {
          assignment_id?: string
          created_at?: string
          id?: string
          overall_quality?: string
          patient_id?: string
          protective_pause_count?: number
          protective_pause_duration_ms_total?: number
          provider_id?: string
          result_payload?: Json
          schema_version?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ulmssr_assignment_ownership_fkey"
            columns: ["assignment_id", "provider_id", "patient_id"]
            isOneToOne: false
            referencedRelation: "upper_limb_motor_screen_assignments"
            referencedColumns: ["id", "provider_id", "patient_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_plan_from_catalog_program: {
        Args: {
          p_assessment_id: string
          p_catalog_assignment_request_id: string
          p_patient_id: string
          p_patient_token: string
          p_program_id: string
          p_provider_id: string
          p_session_prescribed_sides?: Json | null
        }
        Returns: Json
      }
      create_upper_limb_motor_screen_assignment: {
        Args: {
          p_provider_id: string
          p_patient_id: string
          p_assignment_request_id: string | null
          p_assignment_request_payload_hash: string | null
          p_assignment_id: string
          p_status: string
          p_assignment_payload: Json
          p_schema_version: string
        }
        Returns: Json
      }
      rehab_catalog_program_status_for_session: {
        Args: { p_session_id: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
/** Shorthand for a table Row type. */
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type PatientsRow = Tables<"patients">;
export type TreatmentPlansRow = Tables<"treatment_plans">;
export type PlanSessionsRow = Tables<"plan_sessions">;
export type AssessmentsRow = Tables<"assessments">;
export type AiClinicianSummariesRow = Tables<"ai_clinician_summaries">;
export type SpeechTranscriptionSessionsRow = Tables<"speech_transcription_sessions">;

/** Rehabilitation catalog rows (migrations 014–016). */
export type TreatmentProgramsRow = Tables<"treatment_programs">;
export type ProgramSessionsRow = Tables<"program_sessions">;
export type ProgramSessionBlocksRow = Tables<"program_session_blocks">;

/** Upper-limb motor screen persistence rows (migrations 019–020). */
export type UpperLimbMotorScreenAssignmentsRow = Tables<"upper_limb_motor_screen_assignments">;
export type UpperLimbMotorScreenSessionResultsRow = Tables<"upper_limb_motor_screen_session_results">;

/** Interactive Shoulder clinical movement-outcome row (migration 025, O1). */
export type InteractiveShoulderMovementOutcomesRow = Tables<"interactive_shoulder_movement_outcomes">;
