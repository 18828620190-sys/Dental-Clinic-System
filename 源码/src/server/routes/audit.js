import { Router } from 'express';
import { query } from '../db.js';
import { allow } from '../auth.js';
import { asyncHandler } from '../errors.js';
import { paged, parsePagination, safeJson } from '../utils.js';

const router = Router();

router.get('/', allow('HQ_MANAGER'), asyncHandler(async (req,res)=>{
  const {page,pageSize,offset}=parsePagination(req.query);
  const where=['1=1']; const params=[];
  if(req.query.actionType){where.push('a.action_type=?');params.push(req.query.actionType);}
  if(req.query.entityType){where.push('a.entity_type=?');params.push(req.query.entityType);}
  if(req.query.actorUserId){where.push('a.actor_user_id=?');params.push(Number(req.query.actorUserId));}
  if(req.query.from){where.push('a.occurred_at>=?');params.push(req.query.from);}
  if(req.query.to){where.push('a.occurred_at<?');params.push(req.query.to);}
  const condition=where.join(' AND ');
  const total=(await query('SELECT COUNT(*) AS total FROM audit_log a WHERE '+condition,params))[0].total;
  const items=await query(
    "SELECT a.*, u.display_name AS actor_name, u.role_code FROM audit_log a LEFT JOIN user_account u ON u.user_id=a.actor_user_id WHERE "+condition
    +" ORDER BY a.occurred_at DESC LIMIT ? OFFSET ?",
    [...params,pageSize,offset]
  );
  res.json(paged(items.map(r=>({...r,details_json:safeJson(r.details_json)})),Number(total),page,pageSize));
}));

export default router;
