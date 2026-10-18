import { Router } from 'express';
import { query } from '../db.js';
import { isHQ, scopedClinicSql } from '../auth.js';
import { asyncHandler } from '../errors.js';
import { shanghaiToday } from '../utils.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const clinicScope = scopedClinicSql(req.user, 'c.clinic_id');
  const clinics = await query(
    `SELECT c.clinic_id, c.clinic_no, c.postal_address, c.manager_name, c.phone, c.email,
            c.office_area_sqm, c.status
       FROM clinic c WHERE ${clinicScope.sql} ORDER BY c.clinic_no`,
    clinicScope.params
  );
  const qualifications = await query(
    'SELECT qualification_id, qualification_name, status FROM qualification ORDER BY status, qualification_name'
  );
  let dentists;
  if (req.user.role === 'DENTIST') {
    dentists = await query(
      `SELECT d.dentist_id, d.employee_no, u.display_name, u.status
         FROM dentist_profile d JOIN user_account u ON u.user_id = d.user_id
        WHERE d.dentist_id = ?`,
      [req.user.dentistId]
    );
  } else {
    dentists = await query(
      `SELECT d.dentist_id, d.employee_no, u.display_name, u.status
         FROM dentist_profile d JOIN user_account u ON u.user_id = d.user_id
        ORDER BY u.status, u.display_name`
    );
  }
  const treatments = await query(
    `SELECT ti.treatment_item_id, ti.treatment_name, ti.status,
            (SELECT tp.standard_unit_price FROM treatment_price tp
              WHERE tp.treatment_item_id = ti.treatment_item_id AND tp.approval_status = 'APPROVED'
                AND tp.effective_from <= ? ORDER BY tp.effective_from DESC, tp.version_no DESC LIMIT 1) AS current_price
       FROM treatment_item ti ORDER BY ti.status, ti.treatment_name`,
    [shanghaiToday()]
  );
  res.json({
    today: shanghaiToday(),
    isHQ: isHQ(req.user),
    clinics,
    qualifications,
    dentists,
    treatments
  });
}));

export default router;
