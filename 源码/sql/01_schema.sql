-- Dental Clinic Management System
-- MySQL 8.0 logical schema
-- Source design: report/database_design.md
-- This file intentionally contains no seed data, default users, or passwords.

CREATE DATABASE IF NOT EXISTS dental_clinic_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE dental_clinic_db;

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- All DATETIME(6) values are stored in UTC. Business quarter boundaries are
-- calculated in Asia/Shanghai and converted to UTC by the application.

CREATE TABLE user_account (
  user_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary account identifier',
  username VARCHAR(64) NOT NULL COMMENT 'Unique login name',
  password_hash VARCHAR(255) NOT NULL COMMENT 'Password hash, never a plaintext password',
  display_name VARCHAR(100) NOT NULL COMMENT 'User-facing display name',
  role_code ENUM('FRONT_DESK','DENTIST','CLINIC_MANAGER','HQ_MANAGER') NOT NULL COMMENT 'Primary system role',
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE' COMMENT 'Account status',
  last_login_at DATETIME(6) NULL COMMENT 'Last successful login time in UTC',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'Creation time in UTC',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'Last update time in UTC',
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_user_account_username (username),
  KEY idx_user_account_role_status (role_code, status),
  KEY idx_user_account_display_name (display_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='System accounts and roles';

CREATE TABLE clinic (
  clinic_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  clinic_no VARCHAR(32) NOT NULL COMMENT 'Unique clinic business number',
  postal_address VARCHAR(255) NOT NULL,
  manager_name VARCHAR(100) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  email VARCHAR(254) NULL,
  office_area_sqm DECIMAL(10,2) NOT NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (clinic_id),
  UNIQUE KEY uq_clinic_no (clinic_no),
  KEY idx_clinic_address (postal_address),
  KEY idx_clinic_phone (phone),
  KEY idx_clinic_status (status),
  CONSTRAINT chk_clinic_area_positive CHECK (office_area_sqm > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Clinic master data';

CREATE TABLE user_clinic_scope (
  user_id BIGINT UNSIGNED NOT NULL,
  clinic_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id, clinic_id),
  KEY idx_user_clinic_scope_clinic_user (clinic_id, user_id),
  CONSTRAINT fk_user_clinic_scope_user FOREIGN KEY (user_id) REFERENCES user_account (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_user_clinic_scope_clinic FOREIGN KEY (clinic_id) REFERENCES clinic (clinic_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='User access scope by clinic';

CREATE TABLE dentist_profile (
  dentist_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  employee_no VARCHAR(32) NOT NULL,
  birth_date DATE NOT NULL,
  home_address VARCHAR(255) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  email VARCHAR(254) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (dentist_id),
  UNIQUE KEY uq_dentist_profile_user (user_id),
  UNIQUE KEY uq_dentist_profile_employee_no (employee_no),
  KEY idx_dentist_profile_phone (phone),
  KEY idx_dentist_profile_email (email),
  CONSTRAINT fk_dentist_profile_user FOREIGN KEY (user_id) REFERENCES user_account (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Dentist-specific business profile';

CREATE TABLE patient (
  patient_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  patient_no VARCHAR(32) NOT NULL COMMENT 'Global patient number, used as the shared patient identifier',
  patient_name VARCHAR(100) NOT NULL,
  birth_date DATE NOT NULL,
  billing_address VARCHAR(255) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  email VARCHAR(254) NULL,
  emergency_contact_name VARCHAR(100) NOT NULL,
  emergency_contact_phone VARCHAR(32) NOT NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (patient_id),
  UNIQUE KEY uq_patient_no (patient_no),
  KEY idx_patient_name_phone (patient_name, phone),
  KEY idx_patient_birth_phone (birth_date, phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Shared patient master data';

CREATE TABLE patient_allergy (
  allergy_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  patient_id BIGINT UNSIGNED NOT NULL,
  allergy_name VARCHAR(100) NOT NULL,
  note VARCHAR(255) NULL,
  confirmation_status ENUM('CONFIRMED','PENDING') NOT NULL DEFAULT 'PENDING',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (allergy_id),
  UNIQUE KEY uq_patient_allergy_name (patient_id, allergy_name),
  KEY idx_patient_allergy_status (patient_id, confirmation_status),
  CONSTRAINT fk_patient_allergy_patient FOREIGN KEY (patient_id) REFERENCES patient (patient_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Patient allergy records';

CREATE TABLE patient_clinic_relation (
  patient_id BIGINT UNSIGNED NOT NULL,
  clinic_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (patient_id, clinic_id),
  KEY idx_patient_clinic_relation_clinic (clinic_id, patient_id),
  CONSTRAINT fk_patient_clinic_relation_patient FOREIGN KEY (patient_id) REFERENCES patient (patient_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_patient_clinic_relation_clinic FOREIGN KEY (clinic_id) REFERENCES clinic (clinic_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Patient relationship with clinics';

CREATE TABLE qualification (
  qualification_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  qualification_name VARCHAR(100) NOT NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (qualification_id),
  UNIQUE KEY uq_qualification_name (qualification_name),
  KEY idx_qualification_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Qualification and skill dictionary';

CREATE TABLE dentist_qualification (
  dentist_id BIGINT UNSIGNED NOT NULL,
  qualification_id BIGINT UNSIGNED NOT NULL,
  obtained_date DATE NULL,
  verification_status ENUM('PENDING','VERIFIED','REJECTED') NOT NULL DEFAULT 'PENDING',
  verified_by_user_id BIGINT UNSIGNED NULL,
  verified_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (dentist_id, qualification_id),
  KEY idx_dentist_qualification_qualification (qualification_id, verification_status),
  KEY idx_dentist_qualification_verifier (verified_by_user_id),
  CONSTRAINT fk_dentist_qualification_dentist FOREIGN KEY (dentist_id) REFERENCES dentist_profile (dentist_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_dentist_qualification_qualification FOREIGN KEY (qualification_id) REFERENCES qualification (qualification_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_dentist_qualification_verifier FOREIGN KEY (verified_by_user_id) REFERENCES user_account (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Dentist qualification assignments';

CREATE TABLE dentist_schedule (
  schedule_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dentist_id BIGINT UNSIGNED NOT NULL,
  clinic_id BIGINT UNSIGNED NOT NULL,
  available_start_at DATETIME(6) NOT NULL COMMENT 'Available window start in UTC',
  available_end_at DATETIME(6) NOT NULL COMMENT 'Available window end in UTC, exclusive',
  transfer_minutes SMALLINT UNSIGNED NULL,
  status ENUM('DRAFT','PUBLISHED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  coordinator_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (schedule_id),
  UNIQUE KEY uq_dentist_schedule_identity (schedule_id, dentist_id, clinic_id),
  UNIQUE KEY uq_dentist_schedule_start (dentist_id, available_start_at),
  KEY idx_dentist_schedule_dentist_status (dentist_id, status, available_start_at),
  KEY idx_dentist_schedule_clinic_window (clinic_id, available_start_at, available_end_at),
  KEY idx_dentist_schedule_coordinator (coordinator_user_id),
  CONSTRAINT fk_dentist_schedule_dentist FOREIGN KEY (dentist_id) REFERENCES dentist_profile (dentist_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_dentist_schedule_clinic FOREIGN KEY (clinic_id) REFERENCES clinic (clinic_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_dentist_schedule_coordinator FOREIGN KEY (coordinator_user_id) REFERENCES user_account (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_dentist_schedule_time CHECK (available_end_at > available_start_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Dentist availability windows by clinic';

CREATE TABLE schedule_qualification (
  schedule_id BIGINT UNSIGNED NOT NULL,
  qualification_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (schedule_id, qualification_id),
  KEY idx_schedule_qualification_qualification (qualification_id, schedule_id),
  CONSTRAINT fk_schedule_qualification_schedule FOREIGN KEY (schedule_id) REFERENCES dentist_schedule (schedule_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_schedule_qualification_qualification FOREIGN KEY (qualification_id) REFERENCES qualification (qualification_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Required qualifications for a dentist schedule';

CREATE TABLE appointment (
  appointment_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  appointment_no VARCHAR(32) NOT NULL,
  patient_id BIGINT UNSIGNED NOT NULL,
  dentist_id BIGINT UNSIGNED NOT NULL,
  clinic_id BIGINT UNSIGNED NOT NULL,
  schedule_id BIGINT UNSIGNED NOT NULL,
  scheduled_start_at DATETIME(6) NOT NULL COMMENT 'Appointment start in UTC',
  scheduled_end_at DATETIME(6) NOT NULL COMMENT 'Appointment end in UTC, exclusive',
  expected_treatment VARCHAR(500) NOT NULL,
  status ENUM('SCHEDULED','ATTENDED','NO_SHOW','CANCELLED','RESCHEDULED') NOT NULL DEFAULT 'SCHEDULED',
  attendance_flag TINYINT(1) GENERATED ALWAYS AS (CASE WHEN status = 'ATTENDED' THEN 1 ELSE 0 END) STORED,
  cancellation_reason VARCHAR(255) NULL,
  cancellation_initiator ENUM('PATIENT','CLINIC') NULL,
  attendance_recorded_by_user_id BIGINT UNSIGNED NULL,
  attendance_recorded_at DATETIME(6) NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (appointment_id),
  UNIQUE KEY uq_appointment_no (appointment_no),
  KEY idx_appointment_patient_status (patient_id, status),
  KEY idx_appointment_dentist_status_time (dentist_id, status, scheduled_start_at, scheduled_end_at),
  KEY idx_appointment_clinic_status_time (clinic_id, status, scheduled_start_at, scheduled_end_at),
  KEY idx_appointment_attendance_user (attendance_recorded_by_user_id),
  KEY idx_appointment_created_by (created_by_user_id),
  CONSTRAINT fk_appointment_patient FOREIGN KEY (patient_id) REFERENCES patient (patient_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_appointment_schedule_identity FOREIGN KEY (schedule_id, dentist_id, clinic_id) REFERENCES dentist_schedule (schedule_id, dentist_id, clinic_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_appointment_attendance_user FOREIGN KEY (attendance_recorded_by_user_id) REFERENCES user_account (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_appointment_created_by FOREIGN KEY (created_by_user_id) REFERENCES user_account (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_appointment_time CHECK (scheduled_end_at > scheduled_start_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Actual patient appointments';

CREATE TABLE appointment_change (
  change_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  original_appointment_id BIGINT UNSIGNED NOT NULL,
  new_appointment_id BIGINT UNSIGNED NULL,
  change_type ENUM('CANCEL','RESCHEDULE') NOT NULL,
  reason VARCHAR(255) NOT NULL,
  initiator_party ENUM('PATIENT','CLINIC') NOT NULL,
  handled_by_user_id BIGINT UNSIGNED NOT NULL,
  changed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (change_id),
  UNIQUE KEY uq_appointment_change_new (new_appointment_id),
  KEY idx_appointment_change_original_time (original_appointment_id, changed_at),
  KEY idx_appointment_change_handler_time (handled_by_user_id, changed_at),
  CONSTRAINT fk_appointment_change_original FOREIGN KEY (original_appointment_id) REFERENCES appointment (appointment_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_appointment_change_new FOREIGN KEY (new_appointment_id) REFERENCES appointment (appointment_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_appointment_change_handler FOREIGN KEY (handled_by_user_id) REFERENCES user_account (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_appointment_change_new_diff CHECK (new_appointment_id IS NULL OR new_appointment_id <> original_appointment_id),
  CONSTRAINT chk_appointment_change_type CHECK (
    (change_type = 'CANCEL' AND new_appointment_id IS NULL)
    OR (change_type = 'RESCHEDULE' AND new_appointment_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Appointment cancellation and reschedule history';

CREATE TABLE visit (
  visit_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  visit_no VARCHAR(32) NOT NULL,
  appointment_id BIGINT UNSIGNED NOT NULL,
  visit_datetime DATETIME(6) NOT NULL COMMENT 'Actual visit time in UTC',
  patient_problem VARCHAR(1000) NOT NULL,
  special_needs VARCHAR(1000) NULL,
  status ENUM('IN_PROGRESS','COMPLETED','VOID') NOT NULL DEFAULT 'IN_PROGRESS',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (visit_id),
  UNIQUE KEY uq_visit_no (visit_no),
  UNIQUE KEY uq_visit_appointment (appointment_id),
  KEY idx_visit_datetime (visit_datetime),
  KEY idx_visit_status (status),
  CONSTRAINT fk_visit_appointment FOREIGN KEY (appointment_id) REFERENCES appointment (appointment_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Actual visits for scheduled appointments';

CREATE TABLE treatment_item (
  treatment_item_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  treatment_name VARCHAR(100) NOT NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (treatment_item_id),
  UNIQUE KEY uq_treatment_item_name (treatment_name),
  KEY idx_treatment_item_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Standard treatment catalog';

CREATE TABLE treatment_price (
  price_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  treatment_item_id BIGINT UNSIGNED NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  standard_unit_price DECIMAL(12,2) NOT NULL,
  effective_from DATE NOT NULL,
  approval_status ENUM('DRAFT','APPROVED','REJECTED') NOT NULL DEFAULT 'DRAFT',
  approved_by_user_id BIGINT UNSIGNED NULL,
  approved_at DATETIME(6) NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (price_id),
  UNIQUE KEY uq_treatment_price_version (treatment_item_id, version_no),
  UNIQUE KEY uq_treatment_price_effective (treatment_item_id, effective_from),
  KEY idx_treatment_price_lookup (treatment_item_id, approval_status, effective_from),
  KEY idx_treatment_price_approver (approved_by_user_id),
  KEY idx_treatment_price_creator (created_by_user_id),
  CONSTRAINT fk_treatment_price_item FOREIGN KEY (treatment_item_id) REFERENCES treatment_item (treatment_item_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_treatment_price_approver FOREIGN KEY (approved_by_user_id) REFERENCES user_account (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_treatment_price_creator FOREIGN KEY (created_by_user_id) REFERENCES user_account (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_treatment_price_positive CHECK (standard_unit_price > 0),
  CONSTRAINT chk_treatment_price_approved_fields CHECK (
    approval_status <> 'APPROVED'
    OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Versioned standard treatment prices';

CREATE TABLE treatment_detail (
  treatment_detail_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  visit_id BIGINT UNSIGNED NOT NULL,
  treatment_item_id BIGINT UNSIGNED NOT NULL,
  unit_quantity DECIMAL(10,2) NOT NULL,
  unit_price_snapshot DECIMAL(12,2) NOT NULL,
  subtotal DECIMAL(14,2) GENERATED ALWAYS AS (unit_quantity * unit_price_snapshot) STORED,
  status ENUM('ACTIVE','VOID') NOT NULL DEFAULT 'ACTIVE',
  void_reason VARCHAR(255) NULL,
  voided_by_user_id BIGINT UNSIGNED NULL,
  voided_at DATETIME(6) NULL,
  recorded_by_user_id BIGINT UNSIGNED NOT NULL,
  recorded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (treatment_detail_id),
  KEY idx_treatment_detail_visit (visit_id),
  KEY idx_treatment_detail_item (treatment_item_id),
  KEY idx_treatment_detail_recorded_at (recorded_at),
  KEY idx_treatment_detail_voided_by (voided_by_user_id),
  KEY idx_treatment_detail_recorded_by (recorded_by_user_id),
  CONSTRAINT fk_treatment_detail_visit FOREIGN KEY (visit_id) REFERENCES visit (visit_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_treatment_detail_item FOREIGN KEY (treatment_item_id) REFERENCES treatment_item (treatment_item_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_treatment_detail_voided_by FOREIGN KEY (voided_by_user_id) REFERENCES user_account (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_treatment_detail_recorded_by FOREIGN KEY (recorded_by_user_id) REFERENCES user_account (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_treatment_detail_quantity CHECK (unit_quantity > 0),
  CONSTRAINT chk_treatment_detail_price CHECK (unit_price_snapshot >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Actual treatment lines with price snapshots';

CREATE TABLE settlement (
  settlement_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  settlement_no VARCHAR(32) NOT NULL,
  visit_id BIGINT UNSIGNED NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  settlement_date DATETIME(6) NOT NULL COMMENT 'Business settlement date in UTC',
  total_amount DECIMAL(14,2) NOT NULL,
  status ENUM('ACTIVE','VOID') NOT NULL DEFAULT 'ACTIVE',
  activated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'First activation time in UTC, immutable',
  voided_at DATETIME(6) NULL COMMENT 'Void time in UTC, write-once',
  replaces_settlement_id BIGINT UNSIGNED NULL,
  void_reason VARCHAR(255) NULL,
  voided_by_user_id BIGINT UNSIGNED NULL,
  generated_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  active_visit_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status = 'ACTIVE' THEN visit_id ELSE NULL END) STORED,
  PRIMARY KEY (settlement_id),
  UNIQUE KEY uq_settlement_no (settlement_no),
  UNIQUE KEY uq_settlement_visit_version (visit_id, version_no),
  UNIQUE KEY uq_settlement_active_visit (active_visit_id),
  UNIQUE KEY uq_settlement_replaces (replaces_settlement_id),
  KEY idx_settlement_visit_history (visit_id, activated_at, voided_at),
  KEY idx_settlement_date_status (settlement_date, status),
  KEY idx_settlement_generated_by (generated_by_user_id),
  KEY idx_settlement_voided_by (voided_by_user_id),
  CONSTRAINT fk_settlement_visit FOREIGN KEY (visit_id) REFERENCES visit (visit_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_settlement_replaces FOREIGN KEY (replaces_settlement_id) REFERENCES settlement (settlement_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_settlement_generated_by FOREIGN KEY (generated_by_user_id) REFERENCES user_account (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_settlement_voided_by FOREIGN KEY (voided_by_user_id) REFERENCES user_account (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_settlement_total CHECK (total_amount >= 0),
  CONSTRAINT chk_settlement_status_voided CHECK (
    (status = 'ACTIVE' AND voided_at IS NULL)
    OR (status = 'VOID' AND voided_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Settlement versions and current status';

CREATE TABLE settlement_detail (
  settlement_detail_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  settlement_id BIGINT UNSIGNED NOT NULL,
  treatment_detail_id BIGINT UNSIGNED NOT NULL,
  treatment_item_id BIGINT UNSIGNED NOT NULL,
  treatment_name_snapshot VARCHAR(100) NOT NULL,
  unit_quantity_snapshot DECIMAL(10,2) NOT NULL,
  unit_price_snapshot DECIMAL(12,2) NOT NULL,
  subtotal DECIMAL(14,2) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (settlement_detail_id),
  UNIQUE KEY uq_settlement_detail_source (settlement_id, treatment_detail_id),
  KEY idx_settlement_detail_treatment (treatment_detail_id),
  KEY idx_settlement_detail_item (treatment_item_id),
  CONSTRAINT fk_settlement_detail_settlement FOREIGN KEY (settlement_id) REFERENCES settlement (settlement_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_settlement_detail_treatment FOREIGN KEY (treatment_detail_id) REFERENCES treatment_detail (treatment_detail_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_settlement_detail_item FOREIGN KEY (treatment_item_id) REFERENCES treatment_item (treatment_item_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_settlement_detail_quantity CHECK (unit_quantity_snapshot > 0),
  CONSTRAINT chk_settlement_detail_price CHECK (unit_price_snapshot >= 0),
  CONSTRAINT chk_settlement_detail_subtotal CHECK (subtotal = unit_quantity_snapshot * unit_price_snapshot)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Immutable settlement line snapshots';

CREATE TABLE quarterly_cost_entry (
  cost_entry_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cost_entry_no VARCHAR(32) NOT NULL,
  dentist_id BIGINT UNSIGNED NOT NULL,
  clinic_id BIGINT UNSIGNED NULL,
  period_year SMALLINT UNSIGNED NOT NULL,
  quarter_no TINYINT UNSIGNED NOT NULL,
  cost_type ENUM('MEDICAL_SUPPLIES','OPERATING_EXPENSE') NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  source_document_no VARCHAR(64) NULL,
  source_line_no VARCHAR(32) NULL,
  allocation_basis VARCHAR(255) NOT NULL,
  status ENUM('DRAFT','VERIFIED','REJECTED') NOT NULL DEFAULT 'DRAFT',
  recorded_by_user_id BIGINT UNSIGNED NOT NULL,
  verified_by_user_id BIGINT UNSIGNED NULL,
  recorded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  verified_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (cost_entry_id),
  UNIQUE KEY uq_quarterly_cost_entry_no (cost_entry_no),
  KEY idx_quarterly_cost_period (period_year, quarter_no, dentist_id, cost_type, status),
  KEY idx_quarterly_cost_source (source_document_no, source_line_no, dentist_id, clinic_id, cost_type),
  KEY idx_quarterly_cost_clinic (clinic_id),
  KEY idx_quarterly_cost_verifier (verified_by_user_id),
  CONSTRAINT fk_quarterly_cost_dentist FOREIGN KEY (dentist_id) REFERENCES dentist_profile (dentist_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_quarterly_cost_clinic FOREIGN KEY (clinic_id) REFERENCES clinic (clinic_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_quarterly_cost_recorder FOREIGN KEY (recorded_by_user_id) REFERENCES user_account (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_quarterly_cost_verifier FOREIGN KEY (verified_by_user_id) REFERENCES user_account (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_quarterly_cost_quarter CHECK (quarter_no BETWEEN 1 AND 4),
  CONSTRAINT chk_quarterly_cost_amount CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Quarterly costs attributed to dentists';

CREATE TABLE audit_log (
  log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED NULL COMMENT 'NULL for system-generated actions',
  action_type ENUM(
    'CREATE','UPDATE','CANCEL','RESCHEDULE','ATTEND','NO_SHOW',
    'CREATE_SCHEDULE','UPDATE_SCHEDULE',
    'CREATE_COST','VERIFY_COST','REJECT_COST',
    'CREATE_SETTLEMENT','VOID_SETTLEMENT','REGENERATE_SETTLEMENT',
    'CONFIRM_PERFORMANCE_SNAPSHOT','CORRECT_PERFORMANCE_SNAPSHOT','VIEW_PERFORMANCE_SNAPSHOT',
    'QUERY','EXPORT','LOGIN'
  ) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NULL,
  related_entity_id VARCHAR(64) NULL,
  correlation_id CHAR(36) NULL,
  before_status VARCHAR(32) NULL,
  after_status VARCHAR(32) NULL,
  reason VARCHAR(255) NULL,
  occurred_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  details_json JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (log_id),
  KEY idx_audit_actor_time (actor_user_id, occurred_at),
  KEY idx_audit_entity_time (entity_type, entity_id, occurred_at),
  KEY idx_audit_action_time (action_type, occurred_at),
  KEY idx_audit_correlation (correlation_id),
  KEY idx_audit_entity_status_time (entity_type, entity_id, after_status, occurred_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES user_account (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Append-only business audit log';

CREATE TABLE quarterly_performance_snapshot (
  snapshot_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  snapshot_no VARCHAR(32) NOT NULL,
  dentist_id BIGINT UNSIGNED NOT NULL,
  period_year SMALLINT UNSIGNED NOT NULL,
  quarter_no TINYINT UNSIGNED NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  recognized_revenue DECIMAL(14,2) NOT NULL,
  medical_supply_cost DECIMAL(14,2) NOT NULL,
  operating_expense DECIMAL(14,2) NOT NULL,
  net_profit DECIMAL(14,2) NOT NULL,
  data_complete_status ENUM('COMPLETE') NOT NULL DEFAULT 'COMPLETE',
  settled_visit_count INT UNSIGNED NOT NULL,
  unsettled_visit_count INT UNSIGNED NOT NULL,
  data_cutoff_at DATETIME(6) NOT NULL,
  confirmed_by_user_id BIGINT UNSIGNED NOT NULL,
  confirmed_at DATETIME(6) NOT NULL,
  correction_reason VARCHAR(500) NULL,
  supersedes_snapshot_id BIGINT UNSIGNED NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (snapshot_id),
  UNIQUE KEY uq_snapshot_no (snapshot_no),
  UNIQUE KEY uq_snapshot_report_version (dentist_id, period_year, quarter_no, version_no),
  UNIQUE KEY uq_snapshot_identity (snapshot_id, dentist_id, period_year, quarter_no),
  UNIQUE KEY uq_snapshot_supersedes (supersedes_snapshot_id),
  KEY idx_snapshot_period_confirmed (period_year, quarter_no, confirmed_at),
  KEY idx_snapshot_confirmer (confirmed_by_user_id),
  KEY idx_snapshot_supersedes_report (supersedes_snapshot_id, dentist_id, period_year, quarter_no),
  CONSTRAINT fk_snapshot_dentist FOREIGN KEY (dentist_id) REFERENCES dentist_profile (dentist_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_snapshot_confirmer FOREIGN KEY (confirmed_by_user_id) REFERENCES user_account (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_snapshot_supersedes_report FOREIGN KEY (supersedes_snapshot_id, dentist_id, period_year, quarter_no)
    REFERENCES quarterly_performance_snapshot (snapshot_id, dentist_id, period_year, quarter_no)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_snapshot_quarter CHECK (quarter_no BETWEEN 1 AND 4),
  CONSTRAINT chk_snapshot_version CHECK (version_no >= 1),
  CONSTRAINT chk_snapshot_cutoff CHECK (data_cutoff_at <= confirmed_at),
  CONSTRAINT chk_snapshot_complete CHECK (data_complete_status = 'COMPLETE'),
  CONSTRAINT chk_snapshot_unsettled CHECK (unsettled_visit_count = 0),
  CONSTRAINT chk_snapshot_first_version CHECK (
    version_no <> 1 OR (correction_reason IS NULL AND supersedes_snapshot_id IS NULL)
  ),
  CONSTRAINT chk_snapshot_later_version CHECK (
    version_no = 1 OR (correction_reason IS NOT NULL AND supersedes_snapshot_id IS NOT NULL)
  ),
  CONSTRAINT chk_snapshot_net_profit CHECK (
    net_profit = recognized_revenue - medical_supply_cost - operating_expense
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Frozen confirmed quarterly performance snapshots';

CREATE OR REPLACE VIEW v_quarterly_dentist_performance AS
WITH
period_keys AS (
  SELECT dentist_id, period_year, quarter_no
  FROM (
    SELECT
      a.dentist_id,
      YEAR(CONVERT_TZ(s.settlement_date, '+00:00', '+08:00')) AS period_year,
      QUARTER(CONVERT_TZ(s.settlement_date, '+00:00', '+08:00')) AS quarter_no
    FROM settlement s
    JOIN visit v ON v.visit_id = s.visit_id
    JOIN appointment a ON a.appointment_id = v.appointment_id
    WHERE s.status = 'ACTIVE'

    UNION

    SELECT
      a.dentist_id,
      YEAR(CONVERT_TZ(v.visit_datetime, '+00:00', '+08:00')) AS period_year,
      QUARTER(CONVERT_TZ(v.visit_datetime, '+00:00', '+08:00')) AS quarter_no
    FROM visit v
    JOIN appointment a ON a.appointment_id = v.appointment_id

    UNION

    SELECT q.dentist_id, q.period_year, q.quarter_no
    FROM quarterly_cost_entry q

    UNION

    SELECT qs.dentist_id, qs.period_year, qs.quarter_no
    FROM quarterly_performance_snapshot qs
  ) period_source
  GROUP BY dentist_id, period_year, quarter_no
),
revenue AS (
  SELECT
    a.dentist_id,
    YEAR(CONVERT_TZ(s.settlement_date, '+00:00', '+08:00')) AS period_year,
    QUARTER(CONVERT_TZ(s.settlement_date, '+00:00', '+08:00')) AS quarter_no,
    SUM(s.total_amount) AS recognized_revenue,
    COUNT(DISTINCT s.visit_id) AS settled_visit_count
  FROM settlement s
  JOIN visit v ON v.visit_id = s.visit_id
  JOIN appointment a ON a.appointment_id = v.appointment_id
  WHERE s.status = 'ACTIVE'
  GROUP BY
    a.dentist_id,
    YEAR(CONVERT_TZ(s.settlement_date, '+00:00', '+08:00')),
    QUARTER(CONVERT_TZ(s.settlement_date, '+00:00', '+08:00'))
),
unsettled AS (
  SELECT
    pk.dentist_id,
    pk.period_year,
    pk.quarter_no,
    COUNT(DISTINCT v.visit_id) AS unsettled_visit_count
  FROM period_keys pk
  JOIN appointment a ON a.dentist_id = pk.dentist_id
  JOIN visit v ON v.appointment_id = a.appointment_id
  WHERE YEAR(CONVERT_TZ(v.visit_datetime, '+00:00', '+08:00')) = pk.period_year
    AND QUARTER(CONVERT_TZ(v.visit_datetime, '+00:00', '+08:00')) = pk.quarter_no
    AND NOT EXISTS (
      SELECT 1
      FROM settlement s
      WHERE s.visit_id = v.visit_id
        AND s.activated_at < CONVERT_TZ(
          TIMESTAMPADD(QUARTER, pk.quarter_no, MAKEDATE(pk.period_year, 1)),
          '+08:00', '+00:00'
        )
        AND (
          s.voided_at IS NULL
          OR s.voided_at >= CONVERT_TZ(
            TIMESTAMPADD(QUARTER, pk.quarter_no, MAKEDATE(pk.period_year, 1)),
            '+08:00', '+00:00'
          )
        )
    )
  GROUP BY pk.dentist_id, pk.period_year, pk.quarter_no
),
cost_events AS (
  SELECT
    q.cost_entry_id,
    q.dentist_id,
    q.period_year,
    q.quarter_no,
    q.cost_type,
    q.amount,
    a.after_status,
    ROW_NUMBER() OVER (
      PARTITION BY q.cost_entry_id, q.period_year, q.quarter_no
      ORDER BY a.occurred_at DESC, a.log_id DESC
    ) AS row_no
  FROM quarterly_cost_entry q
  JOIN audit_log a
    ON a.entity_type = 'quarterly_cost_entry'
   AND a.entity_id = q.cost_entry_no
  WHERE a.occurred_at < CONVERT_TZ(
    TIMESTAMPADD(QUARTER, q.quarter_no, MAKEDATE(q.period_year, 1)),
    '+08:00', '+00:00'
  )
),
cost_at_q_end AS (
  SELECT
    cost_entry_id,
    dentist_id,
    period_year,
    quarter_no,
    cost_type,
    amount,
    after_status
  FROM cost_events
  WHERE row_no = 1
),
cost_summary AS (
  SELECT
    dentist_id,
    period_year,
    quarter_no,
    SUM(CASE WHEN cost_type = 'MEDICAL_SUPPLIES' AND after_status = 'DRAFT' THEN 1 ELSE 0 END) AS medical_draft_count,
    SUM(CASE WHEN cost_type = 'MEDICAL_SUPPLIES' AND after_status = 'VERIFIED' THEN 1 ELSE 0 END) AS medical_verified_count,
    SUM(CASE WHEN cost_type = 'MEDICAL_SUPPLIES' AND after_status = 'REJECTED' THEN 1 ELSE 0 END) AS medical_rejected_count,
    SUM(CASE WHEN cost_type = 'MEDICAL_SUPPLIES' AND after_status = 'VERIFIED' THEN amount END) AS medical_verified_amount,
    SUM(CASE WHEN cost_type = 'OPERATING_EXPENSE' AND after_status = 'DRAFT' THEN 1 ELSE 0 END) AS operating_draft_count,
    SUM(CASE WHEN cost_type = 'OPERATING_EXPENSE' AND after_status = 'VERIFIED' THEN 1 ELSE 0 END) AS operating_verified_count,
    SUM(CASE WHEN cost_type = 'OPERATING_EXPENSE' AND after_status = 'REJECTED' THEN 1 ELSE 0 END) AS operating_rejected_count,
    SUM(CASE WHEN cost_type = 'OPERATING_EXPENSE' AND after_status = 'VERIFIED' THEN amount END) AS operating_verified_amount
  FROM cost_at_q_end
  GROUP BY dentist_id, period_year, quarter_no
),
snapshot_latest_raw AS (
  SELECT
    qs.snapshot_id,
    qs.snapshot_no,
    qs.dentist_id,
    qs.period_year,
    qs.quarter_no,
    qs.version_no,
    qs.recognized_revenue,
    qs.medical_supply_cost,
    qs.operating_expense,
    qs.net_profit,
    qs.data_complete_status,
    qs.settled_visit_count,
    qs.unsettled_visit_count,
    qs.data_cutoff_at,
    qs.confirmed_by_user_id,
    qs.confirmed_at,
    ROW_NUMBER() OVER (
      PARTITION BY qs.dentist_id, qs.period_year, qs.quarter_no
      ORDER BY qs.version_no DESC
    ) AS row_no
  FROM quarterly_performance_snapshot qs
  WHERE qs.data_complete_status = 'COMPLETE'
),
snapshot_latest AS (
  SELECT *
  FROM snapshot_latest_raw
  WHERE row_no = 1
),
provisional AS (
  SELECT
    pk.dentist_id,
    pk.period_year,
    pk.quarter_no,
    CASE
      WHEN COALESCE(u.unsettled_visit_count, 0) = 0
        THEN COALESCE(r.recognized_revenue, 0)
      ELSE r.recognized_revenue
    END AS recognized_revenue,
    COALESCE(r.settled_visit_count, 0) AS settled_visit_count,
    COALESCE(u.unsettled_visit_count, 0) AS unsettled_visit_count,
    CASE
      WHEN COALESCE(c.medical_draft_count, 0) > 0 THEN 'PENDING'
      WHEN COALESCE(c.medical_verified_count, 0) > 0 AND c.medical_verified_amount = 0 THEN 'CONFIRMED_ZERO'
      WHEN COALESCE(c.medical_verified_count, 0) > 0 THEN 'CONFIRMED'
      WHEN COALESCE(c.medical_rejected_count, 0) > 0 THEN 'REJECTED_ONLY'
      ELSE 'MISSING'
    END AS medical_supply_status,
    CASE
      WHEN COALESCE(c.operating_draft_count, 0) > 0 THEN 'PENDING'
      WHEN COALESCE(c.operating_verified_count, 0) > 0 AND c.operating_verified_amount = 0 THEN 'CONFIRMED_ZERO'
      WHEN COALESCE(c.operating_verified_count, 0) > 0 THEN 'CONFIRMED'
      WHEN COALESCE(c.operating_rejected_count, 0) > 0 THEN 'REJECTED_ONLY'
      ELSE 'MISSING'
    END AS operating_expense_status,
    c.medical_verified_amount AS medical_supply_cost,
    c.operating_verified_amount AS operating_expense,
    COALESCE(c.medical_draft_count, 0) + COALESCE(c.operating_draft_count, 0) AS draft_cost_entry_count,
    COALESCE(c.medical_rejected_count, 0) + COALESCE(c.operating_rejected_count, 0) AS rejected_cost_entry_count,
    CASE
      WHEN COALESCE(c.medical_verified_count, 0) = 0
        OR COALESCE(c.operating_verified_count, 0) = 0
      THEN 1
      ELSE 0
    END AS missing_cost_category_count,
    CASE WHEN COALESCE(u.unsettled_visit_count, 0) = 0 THEN 1 ELSE 0 END AS revenue_data_complete_flag,
    CASE
      WHEN COALESCE(c.medical_draft_count, 0) = 0
        AND COALESCE(c.operating_draft_count, 0) = 0
        AND COALESCE(c.medical_verified_count, 0) > 0
        AND COALESCE(c.operating_verified_count, 0) > 0
      THEN 1
      ELSE 0
    END AS cost_data_complete_flag,
    CASE
      WHEN COALESCE(u.unsettled_visit_count, 0) = 0
        AND COALESCE(c.medical_draft_count, 0) = 0
        AND COALESCE(c.operating_draft_count, 0) = 0
        AND COALESCE(c.medical_verified_count, 0) > 0
        AND COALESCE(c.operating_verified_count, 0) > 0
      THEN CASE
        WHEN COALESCE(u.unsettled_visit_count, 0) = 0
          THEN COALESCE(r.recognized_revenue, 0)
        ELSE r.recognized_revenue
      END - c.medical_verified_amount - c.operating_verified_amount
      ELSE NULL
    END AS calculated_net_profit,
    UTC_TIMESTAMP(6) AS data_updated_at
  FROM period_keys pk
  LEFT JOIN revenue r
    ON r.dentist_id = pk.dentist_id
   AND r.period_year = pk.period_year
   AND r.quarter_no = pk.quarter_no
  LEFT JOIN unsettled u
    ON u.dentist_id = pk.dentist_id
   AND u.period_year = pk.period_year
   AND u.quarter_no = pk.quarter_no
  LEFT JOIN cost_summary c
    ON c.dentist_id = pk.dentist_id
   AND c.period_year = pk.period_year
   AND c.quarter_no = pk.quarter_no
)
SELECT
  pk.dentist_id,
  pk.period_year,
  pk.quarter_no,
  CASE WHEN sl.snapshot_id IS NULL THEN 'PROVISIONAL' ELSE 'CONFIRMED_SNAPSHOT' END AS data_source,
  sl.snapshot_id,
  sl.version_no AS snapshot_version_no,
  sl.confirmed_at AS snapshot_confirmed_at,
  COALESCE(sl.recognized_revenue, p.recognized_revenue) AS recognized_revenue,
  COALESCE(sl.settled_visit_count, p.settled_visit_count) AS settled_visit_count,
  COALESCE(sl.unsettled_visit_count, p.unsettled_visit_count) AS unsettled_visit_count_at_q_end,
  CASE
    WHEN sl.snapshot_id IS NOT NULL AND sl.medical_supply_cost = 0 THEN 'CONFIRMED_ZERO'
    WHEN sl.snapshot_id IS NOT NULL THEN 'CONFIRMED'
    ELSE p.medical_supply_status
  END AS medical_supply_status,
  CASE
    WHEN sl.snapshot_id IS NOT NULL AND sl.operating_expense = 0 THEN 'CONFIRMED_ZERO'
    WHEN sl.snapshot_id IS NOT NULL THEN 'CONFIRMED'
    ELSE p.operating_expense_status
  END AS operating_expense_status,
  COALESCE(sl.medical_supply_cost, p.medical_supply_cost) AS medical_supply_cost,
  COALESCE(sl.operating_expense, p.operating_expense) AS operating_expense,
  CASE WHEN sl.snapshot_id IS NULL THEN p.draft_cost_entry_count ELSE 0 END AS draft_cost_entry_count,
  CASE WHEN sl.snapshot_id IS NULL THEN p.rejected_cost_entry_count ELSE 0 END AS rejected_cost_entry_count,
  CASE WHEN sl.snapshot_id IS NULL THEN p.missing_cost_category_count ELSE 0 END AS missing_cost_category_count,
  CASE WHEN sl.snapshot_id IS NULL THEN p.revenue_data_complete_flag ELSE 1 END AS revenue_data_complete_flag,
  CASE WHEN sl.snapshot_id IS NULL THEN p.cost_data_complete_flag ELSE 1 END AS cost_data_complete_flag,
  CASE
    WHEN sl.snapshot_id IS NOT NULL THEN 'CONFIRMED_COMPLETE'
    WHEN p.revenue_data_complete_flag = 1 AND p.cost_data_complete_flag = 1 THEN 'PROVISIONAL_COMPLETE'
    ELSE 'PROVISIONAL_INCOMPLETE'
  END AS performance_status,
  COALESCE(sl.net_profit, p.calculated_net_profit) AS calculated_net_profit,
  COALESCE(sl.data_cutoff_at, p.data_updated_at) AS data_cutoff_at,
  COALESCE(sl.confirmed_at, p.data_updated_at) AS data_updated_at
FROM period_keys pk
LEFT JOIN snapshot_latest sl
  ON sl.dentist_id = pk.dentist_id
 AND sl.period_year = pk.period_year
 AND sl.quarter_no = pk.quarter_no
LEFT JOIN provisional p
  ON p.dentist_id = pk.dentist_id
 AND p.period_year = pk.period_year
 AND p.quarter_no = pk.quarter_no;

-- ---------------------------------------------------------------------------
-- Rules intentionally not implemented as database objects in this file
-- ---------------------------------------------------------------------------
-- 1. Appointment and schedule interval overlap require transactional locking
--    and FOR UPDATE checks; MySQL 8.0 does not provide interval exclusion
--    constraints.
-- 2. Snapshot version continuity and "previous version" selection require a
--    transaction that locks the dentist profile and current highest version.
-- 3. Snapshot immutability requires application DB privileges that deny
--    ordinary UPDATE and DELETE operations. Optional triggers can add a second
--    enforcement layer.
-- 4. Confirmation and correction must write audit_log in the same transaction.
-- 5. Settlement total must equal the sum of settlement_detail subtotals; this
--    is checked by the settlement transaction because it is cross-row logic.
-- 6. Cost duplicate detection and completeness require transaction/business
--    rules; nullable source document fields cannot be made reliably unique in
--    MySQL without blocking legitimate multiple cost lines.
-- 7. No default users, passwords, credentials, or business seed data are
--    included in this schema file.
