#![allow(dead_code)] // Compatibility operations support the tested delivery state machine.

use rusqlite::{named_params, params, OptionalExtension, Row};
use serde::de::DeserializeOwned;

use super::{now, Store};
use crate::{
    error::{AppError, Result},
    model::*,
};

impl Store {
    pub fn set_delivery_status(&self, id: &str, status: &str) -> Result<()> {
        let location_id = self.resolve_workspace_location_id(id)?;
        self.0.lock().execute(
            "UPDATE workspace_repositories SET delivery_status=?,updated_at=? WHERE id=?",
            params![status, now(), location_id],
        )?;
        Ok(())
    }

    pub fn update_workspace_delivery(
        &self,
        id: &str,
        remote_name: Option<&str>,
        remote_branch: Option<&str>,
        delivery_mode: &str,
    ) -> Result<()> {
        let location_id = self.resolve_workspace_location_id(id)?;
        let changed = self.0.lock().execute("UPDATE workspace_repositories SET remote_name=?,remote_branch=?,delivery_mode=?,updated_at=? WHERE id=?", params![remote_name,remote_branch,delivery_mode,now(),location_id])?;
        if changed == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub fn delivery_operation(&self, workspace_id: &str) -> Result<Option<DeliveryOperation>> {
        let location_id = self.resolve_workspace_location_id(workspace_id)?;
        let db = self.0.lock();
        Ok(db
            .query_row(
                &format!(
                    "SELECT {SETTLEMENT_OPERATION_COLUMNS} FROM delivery_operations WHERE workspace_repository_id=?"
                ),
                [location_id],
                delivery_operation_row,
            )
            .optional()?)
    }

    pub fn create_delivery_operation(&self, operation: &DeliveryOperation) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO delivery_operations(workspace_repository_id,phase,code_action,todo_action,push_after_merge,keep_session_history,delete_worktree,delete_branch,commit_message,before_head,source_head,target_head,integrated_commit,error,started_at,updated_at)
             VALUES(:workspace_location_id,:phase,:code_action,:todo_action,:push_after_merge,:keep_session_history,:delete_worktree,:delete_branch,:commit_message,:before_head,:source_head,:target_head,:integrated_commit,:error,:started_at,:updated_at)",
            named_params! {
                ":workspace_location_id": operation.workspace_location_id,
                ":phase": operation.phase,
                ":code_action": operation.code_action,
                ":todo_action": operation.todo_action,
                ":push_after_merge": operation.push_after_merge,
                ":keep_session_history": operation.keep_session_history,
                ":delete_worktree": operation.delete_worktree,
                ":delete_branch": operation.delete_branch,
                ":commit_message": operation.commit_message,
                ":before_head": operation.before_head,
                ":source_head": operation.source_head,
                ":target_head": operation.target_head,
                ":integrated_commit": operation.integrated_commit,
                ":error": operation.error,
                ":started_at": operation.started_at,
                ":updated_at": operation.updated_at,
            },
        )?;
        Ok(())
    }

    pub fn advance_delivery(
        &self,
        workspace_id: &str,
        phase: &str,
        source_head: Option<&str>,
        target_head: Option<&str>,
        integrated_commit: Option<&str>,
    ) -> Result<()> {
        let location_id = self.resolve_workspace_location_id(workspace_id)?;
        self.0.lock().execute(
            "UPDATE delivery_operations SET phase=?,source_head=COALESCE(?,source_head),target_head=COALESCE(?,target_head),integrated_commit=COALESCE(?,integrated_commit),error='',updated_at=? WHERE workspace_repository_id=?",
            params![phase, source_head, target_head, integrated_commit, now(), location_id],
        )?;
        Ok(())
    }

    pub fn set_delivery_error(&self, workspace_id: &str, error: &str) -> Result<()> {
        let location_id = self.resolve_workspace_location_id(workspace_id)?;
        self.0.lock().execute(
            "UPDATE delivery_operations SET error=?,updated_at=? WHERE workspace_repository_id=?",
            params![error, now(), location_id],
        )?;
        Ok(())
    }

    pub fn latest_rebase_operation(&self, workspace_id: &str) -> Result<Option<RebaseOperation>> {
        let location_id = self.resolve_workspace_location_id(workspace_id)?;
        let db = self.0.lock();
        Ok(db
            .query_row(
                &format!(
                    "SELECT {REBASE_OPERATION_COLUMNS} FROM rebase_operations WHERE workspace_repository_id=? ORDER BY updated_at DESC,rowid DESC LIMIT 1"
                ),
                [location_id],
                rebase_operation_row,
            )
            .optional()?)
    }

    pub fn rebase_operations(&self, workspace_id: &str) -> Result<Vec<RebaseOperation>> {
        let location_id = self.resolve_workspace_location_id(workspace_id)?;
        let db = self.0.lock();
        let mut stmt = db.prepare(&format!(
            "SELECT {REBASE_OPERATION_COLUMNS} FROM rebase_operations WHERE workspace_repository_id=? ORDER BY started_at DESC,rowid DESC"
        ))?;
        let values = stmt
            .query_map([location_id], rebase_operation_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn create_rebase_operation(&self, operation: &RebaseOperation) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO rebase_operations(id,workspace_repository_id,status,phase,before_head,target_head,rebased_head,recovery_ref,error,started_at,updated_at,completed_at)
             VALUES(:id,:workspace_location_id,:status,:phase,:before_head,:target_head,:rebased_head,:recovery_ref,:error,:started_at,:updated_at,:completed_at)",
            named_params! {
                ":id": operation.id,
                ":workspace_location_id": operation.workspace_location_id,
                ":status": operation.status,
                ":phase": operation.phase,
                ":before_head": operation.before_head,
                ":target_head": operation.target_head,
                ":rebased_head": operation.rebased_head,
                ":recovery_ref": operation.recovery_ref,
                ":error": operation.error,
                ":started_at": operation.started_at,
                ":updated_at": operation.updated_at,
                ":completed_at": operation.completed_at,
            },
        )?;
        Ok(())
    }

    pub fn update_rebase_operation(
        &self,
        id: &str,
        status: &str,
        phase: &str,
        rebased_head: Option<&str>,
        error: &str,
        completed: bool,
    ) -> Result<()> {
        let timestamp = now();
        self.0.lock().execute(
            "UPDATE rebase_operations SET status=?,phase=?,rebased_head=COALESCE(?,rebased_head),error=?,updated_at=?,completed_at=CASE WHEN ? THEN COALESCE(completed_at,?) ELSE completed_at END WHERE id=?",
            params![
                status,
                phase,
                rebased_head,
                error,
                timestamp,
                completed,
                timestamp,
                id,
            ],
        )?;
        Ok(())
    }

    pub fn parent_operation(&self, id: &str) -> Result<ParentOperation> {
        let db = self.0.lock();
        Ok(db.query_row(
            &format!("SELECT {PARENT_OPERATION_COLUMNS} FROM parent_operations WHERE id=?"),
            [id],
            parent_operation_row,
        )?)
    }

    pub fn latest_parent_operation(
        &self,
        workspace_repository_id: &str,
        direction: &str,
    ) -> Result<Option<ParentOperation>> {
        let db = self.0.lock();
        Ok(db
            .query_row(
                &format!("SELECT {PARENT_OPERATION_COLUMNS} FROM parent_operations WHERE workspace_repository_id=? AND direction=? ORDER BY updated_at DESC,rowid DESC LIMIT 1"),
                params![workspace_repository_id, direction],
                parent_operation_row,
            )
            .optional()?)
    }

    pub fn active_parent_operation_for_target(
        &self,
        source_repository_id: &str,
        target_path: &str,
    ) -> Result<Option<ParentOperation>> {
        let db = self.0.lock();
        Ok(db
            .query_row(
                &format!("SELECT {PARENT_OPERATION_COLUMNS} FROM parent_operations WHERE source_repository_id=? AND target_path=? AND status IN ('active','conflicted','resolving','recovery_required') ORDER BY updated_at DESC,rowid DESC LIMIT 1"),
                params![source_repository_id, target_path],
                parent_operation_row,
            )
            .optional()?)
    }

    pub fn parent_operations(&self, workspace_id: &str) -> Result<Vec<ParentOperation>> {
        let db = self.0.lock();
        let mut statement = db.prepare(&format!(
            "SELECT {PARENT_OPERATION_COLUMNS} FROM parent_operations WHERE workspace_id=? ORDER BY started_at DESC,rowid DESC"
        ))?;
        let operations = statement
            .query_map([workspace_id], parent_operation_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(operations)
    }

    pub fn create_parent_operation(&self, operation: &ParentOperation) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO parent_operations(id,workspace_repository_id,workspace_id,direction,strategy,origin,source_repository_id,source_path,source_branch,target_scope,target_workspace_id,target_path,target_branch,source_head,parent_head,before_head,result_head,recovery_ref,status,phase,resolver_session_id,delivery_operation_id,undo_available,error,started_at,updated_at,completed_at)
             VALUES(:id,:workspace_repository_id,:workspace_id,:direction,:strategy,:origin,:source_repository_id,:source_path,:source_branch,:target_scope,:target_workspace_id,:target_path,:target_branch,:source_head,:parent_head,:before_head,:result_head,:recovery_ref,:status,:phase,:resolver_session_id,:delivery_operation_id,:undo_available,:error,:started_at,:updated_at,:completed_at)",
            named_params! {
                ":id": operation.id,
                ":workspace_repository_id": operation.workspace_repository_id,
                ":workspace_id": operation.workspace_id,
                ":direction": operation.direction,
                ":strategy": operation.strategy,
                ":origin": operation.origin,
                ":source_repository_id": operation.source_repository_id,
                ":source_path": operation.source_path,
                ":source_branch": operation.source_branch,
                ":target_scope": operation.target_scope,
                ":target_workspace_id": operation.target_workspace_id,
                ":target_path": operation.target_path,
                ":target_branch": operation.target_branch,
                ":source_head": operation.source_head,
                ":parent_head": operation.parent_head,
                ":before_head": operation.before_head,
                ":result_head": operation.result_head,
                ":recovery_ref": operation.recovery_ref,
                ":status": operation.status,
                ":phase": operation.phase,
                ":resolver_session_id": operation.resolver_session_id,
                ":delivery_operation_id": operation.delivery_operation_id,
                ":undo_available": operation.undo_available,
                ":error": operation.error,
                ":started_at": operation.started_at,
                ":updated_at": operation.updated_at,
                ":completed_at": operation.completed_at,
            },
        )?;
        Ok(())
    }

    pub fn update_parent_operation(
        &self,
        id: &str,
        status: &str,
        phase: &str,
        result_head: Option<&str>,
        error: &str,
        terminal: bool,
        undo_available: bool,
    ) -> Result<()> {
        let timestamp = now();
        self.0.lock().execute(
            "UPDATE parent_operations SET status=?,phase=?,result_head=COALESCE(?,result_head),error=?,undo_available=?,updated_at=?,completed_at=CASE WHEN ? THEN COALESCE(completed_at,?) ELSE completed_at END WHERE id=?",
            params![status, phase, result_head, error, undo_available, timestamp, terminal, timestamp, id],
        )?;
        Ok(())
    }

    pub fn set_parent_operation_resolver(&self, id: &str, session_id: &str) -> Result<()> {
        self.0.lock().execute(
            "UPDATE parent_operations SET resolver_session_id=?,status='resolving',phase='resolving',error='',updated_at=? WHERE id=?",
            params![session_id, now(), id],
        )?;
        Ok(())
    }

    pub fn supersede_parent_operation_undo(
        &self,
        source_repository_id: &str,
        target_path: &str,
        except_id: &str,
    ) -> Result<()> {
        self.0.lock().execute(
            "UPDATE parent_operations SET undo_available=0,phase=CASE WHEN status='completed' THEN 'superseded' ELSE phase END,updated_at=? WHERE source_repository_id=? AND target_path=? AND id!=? AND undo_available=1",
            params![now(), source_repository_id, target_path, except_id],
        )?;
        Ok(())
    }

    pub fn consume_parent_operation_undo(&self, id: &str) -> Result<()> {
        self.0.lock().execute(
            "UPDATE parent_operations SET undo_available=0,phase=CASE WHEN status='completed' THEN 'consumed' ELSE phase END,updated_at=? WHERE id=?",
            params![now(), id],
        )?;
        Ok(())
    }

    pub fn create_delivery_preflight(&self, preflight: &DeliveryPreflight) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO delivery_preflights(id,workspace_repository_id,code_action,source_head,target_head,target_branch,source_status,source_dirty,target_dirty,ahead,behind,changed_files,commits,diff_stat,blockers,warnings,created_at)
             VALUES(:id,:workspace_location_id,:code_action,:source_head,:target_head,:target_branch,:source_status,:source_dirty,:target_dirty,:ahead,:behind,:changed_files,:commits,:diff_stat,:blockers,:warnings,:created_at)",
            named_params! {
                ":id": preflight.id,
                ":workspace_location_id": preflight.workspace_location_id,
                ":code_action": preflight.code_action,
                ":source_head": preflight.source_head,
                ":target_head": preflight.target_head,
                ":target_branch": preflight.target_branch,
                ":source_status": preflight.source_status,
                ":source_dirty": preflight.source_dirty,
                ":target_dirty": preflight.target_dirty,
                ":ahead": preflight.ahead,
                ":behind": preflight.behind,
                ":changed_files": serde_json::to_string(&preflight.changed_files).map_err(anyhow::Error::from)?,
                ":commits": serde_json::to_string(&preflight.commits).map_err(anyhow::Error::from)?,
                ":diff_stat": preflight.diff_stat,
                ":blockers": serde_json::to_string(&preflight.blockers).map_err(anyhow::Error::from)?,
                ":warnings": serde_json::to_string(&preflight.warnings).map_err(anyhow::Error::from)?,
                ":created_at": preflight.created_at,
            },
        )?;
        Ok(())
    }

    pub fn delivery_preflight(&self, id: &str) -> Result<DeliveryPreflight> {
        let db = self.0.lock();
        Ok(db.query_row(
            "SELECT id,workspace_repository_id AS workspace_location_id,code_action,source_head,target_head,target_branch,source_status,source_dirty,target_dirty,ahead,behind,changed_files,commits,diff_stat,blockers,warnings,created_at FROM delivery_preflights WHERE id=?",
            [id],
            delivery_preflight_row,
        )?)
    }

    pub fn reset_operation(&self, id: &str) -> Result<ResetOperation> {
        let db = self.0.lock();
        Ok(db.query_row(
            &format!("SELECT {RESET_OPERATION_COLUMNS} FROM reset_operations WHERE id=?"),
            [id],
            reset_operation_row,
        )?)
    }

    pub fn latest_reset_operation(&self, workspace_id: &str) -> Result<Option<ResetOperation>> {
        let location_id = self.resolve_workspace_location_id(workspace_id)?;
        let db = self.0.lock();
        Ok(db
            .query_row(
                &format!("SELECT {RESET_OPERATION_COLUMNS} FROM reset_operations WHERE workspace_repository_id=? ORDER BY started_at DESC,rowid DESC LIMIT 1"),
                [location_id],
                reset_operation_row,
            )
            .optional()?)
    }

    pub fn reset_operations(&self, workspace_id: &str) -> Result<Vec<ResetOperation>> {
        let location_id = self.resolve_workspace_location_id(workspace_id)?;
        let db = self.0.lock();
        let mut stmt = db.prepare(&format!(
            "SELECT {RESET_OPERATION_COLUMNS} FROM reset_operations WHERE workspace_repository_id=? ORDER BY started_at DESC,rowid DESC"
        ))?;
        let values = stmt
            .query_map([location_id], reset_operation_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(values)
    }

    pub fn create_reset_operation(&self, operation: &ResetOperation) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO reset_operations(id,workspace_repository_id,status,mode,before_head,target_head,result_head,recovery_ref,error,started_at,updated_at,completed_at)
             VALUES(:id,:workspace_location_id,:status,:mode,:before_head,:target_head,:result_head,:recovery_ref,:error,:started_at,:updated_at,:completed_at)",
            named_params! {
                ":id": operation.id,
                ":workspace_location_id": operation.workspace_location_id,
                ":status": operation.status,
                ":mode": operation.mode,
                ":before_head": operation.before_head,
                ":target_head": operation.target_head,
                ":result_head": operation.result_head,
                ":recovery_ref": operation.recovery_ref,
                ":error": operation.error,
                ":started_at": operation.started_at,
                ":updated_at": operation.updated_at,
                ":completed_at": operation.completed_at,
            },
        )?;
        Ok(())
    }

    pub fn update_reset_operation(
        &self,
        id: &str,
        status: &str,
        result_head: Option<&str>,
        error: &str,
        completed: bool,
    ) -> Result<()> {
        let timestamp = now();
        self.0.lock().execute(
            "UPDATE reset_operations SET status=?,result_head=COALESCE(?,result_head),error=?,updated_at=?,completed_at=CASE WHEN ? THEN COALESCE(completed_at,?) ELSE completed_at END WHERE id=?",
            params![status, result_head, error, timestamp, completed, timestamp, id],
        )?;
        Ok(())
    }
}

const SETTLEMENT_OPERATION_COLUMNS: &str = "workspace_repository_id AS workspace_location_id,phase,code_action,todo_action,push_after_merge,keep_session_history,delete_worktree,delete_branch,commit_message,before_head,source_head,target_head,integrated_commit,error,started_at,updated_at";

fn delivery_operation_row(r: &Row<'_>) -> rusqlite::Result<DeliveryOperation> {
    Ok(DeliveryOperation {
        workspace_location_id: r.get("workspace_location_id")?,
        workspace_id: r.get("workspace_location_id")?,
        phase: r.get("phase")?,
        code_action: r.get("code_action")?,
        todo_action: r.get("todo_action")?,
        push_after_merge: r.get("push_after_merge")?,
        keep_session_history: r.get("keep_session_history")?,
        delete_worktree: r.get("delete_worktree")?,
        delete_branch: r.get("delete_branch")?,
        commit_message: r.get("commit_message")?,
        before_head: r.get("before_head")?,
        source_head: r.get("source_head")?,
        target_head: r.get("target_head")?,
        integrated_commit: r.get("integrated_commit")?,
        error: r.get("error")?,
        started_at: r.get("started_at")?,
        updated_at: r.get("updated_at")?,
    })
}

const REBASE_OPERATION_COLUMNS: &str = "id,workspace_repository_id AS workspace_location_id,status,phase,before_head,target_head,rebased_head,recovery_ref,error,started_at,updated_at,completed_at";

const PARENT_OPERATION_COLUMNS: &str = "id,workspace_repository_id,workspace_id,direction,strategy,origin,source_repository_id,source_path,source_branch,target_scope,target_workspace_id,target_path,target_branch,source_head,parent_head,before_head,result_head,recovery_ref,status,phase,resolver_session_id,delivery_operation_id,undo_available,error,started_at,updated_at,completed_at";

fn parent_operation_row(r: &Row<'_>) -> rusqlite::Result<ParentOperation> {
    Ok(ParentOperation {
        id: r.get("id")?,
        workspace_repository_id: r.get("workspace_repository_id")?,
        workspace_id: r.get("workspace_id")?,
        direction: r.get("direction")?,
        strategy: r.get("strategy")?,
        origin: r.get("origin")?,
        source_repository_id: r.get("source_repository_id")?,
        source_path: r.get("source_path")?,
        source_branch: r.get("source_branch")?,
        target_scope: r.get("target_scope")?,
        target_workspace_id: r.get("target_workspace_id")?,
        target_path: r.get("target_path")?,
        target_branch: r.get("target_branch")?,
        source_head: r.get("source_head")?,
        parent_head: r.get("parent_head")?,
        before_head: r.get("before_head")?,
        result_head: r.get("result_head")?,
        recovery_ref: r.get("recovery_ref")?,
        status: r.get("status")?,
        phase: r.get("phase")?,
        resolver_session_id: r.get("resolver_session_id")?,
        delivery_operation_id: r.get("delivery_operation_id")?,
        undo_available: r.get("undo_available")?,
        error: r.get("error")?,
        started_at: r.get("started_at")?,
        updated_at: r.get("updated_at")?,
        completed_at: r.get("completed_at")?,
    })
}

fn rebase_operation_row(r: &Row<'_>) -> rusqlite::Result<RebaseOperation> {
    Ok(RebaseOperation {
        id: r.get("id")?,
        workspace_location_id: r.get("workspace_location_id")?,
        workspace_id: r.get("workspace_location_id")?,
        status: r.get("status")?,
        phase: r.get("phase")?,
        before_head: r.get("before_head")?,
        target_head: r.get("target_head")?,
        rebased_head: r.get("rebased_head")?,
        recovery_ref: r.get("recovery_ref")?,
        error: r.get("error")?,
        started_at: r.get("started_at")?,
        updated_at: r.get("updated_at")?,
        completed_at: r.get("completed_at")?,
    })
}

const RESET_OPERATION_COLUMNS: &str = "id,workspace_repository_id AS workspace_location_id,status,mode,before_head,target_head,result_head,recovery_ref,error,started_at,updated_at,completed_at";

fn reset_operation_row(r: &Row<'_>) -> rusqlite::Result<ResetOperation> {
    Ok(ResetOperation {
        id: r.get("id")?,
        workspace_location_id: r.get("workspace_location_id")?,
        workspace_id: r.get("workspace_location_id")?,
        status: r.get("status")?,
        mode: r.get("mode")?,
        before_head: r.get("before_head")?,
        target_head: r.get("target_head")?,
        result_head: r.get("result_head")?,
        recovery_ref: r.get("recovery_ref")?,
        error: r.get("error")?,
        started_at: r.get("started_at")?,
        updated_at: r.get("updated_at")?,
        completed_at: r.get("completed_at")?,
    })
}

fn delivery_preflight_row(r: &Row<'_>) -> rusqlite::Result<DeliveryPreflight> {
    Ok(DeliveryPreflight {
        id: r.get("id")?,
        workspace_location_id: r.get("workspace_location_id")?,
        workspace_id: r.get("workspace_location_id")?,
        code_action: r.get("code_action")?,
        source_head: r.get("source_head")?,
        target_head: r.get("target_head")?,
        target_branch: r.get("target_branch")?,
        source_status: r.get("source_status")?,
        source_dirty: r.get("source_dirty")?,
        target_dirty: r.get("target_dirty")?,
        ahead: r.get("ahead")?,
        behind: r.get("behind")?,
        changed_files: decode_json_column(r, "changed_files")?,
        commits: decode_json_column(r, "commits")?,
        diff_stat: r.get("diff_stat")?,
        blockers: decode_json_column(r, "blockers")?,
        warnings: decode_json_column(r, "warnings")?,
        created_at: r.get("created_at")?,
    })
}

fn decode_json_column<T: DeserializeOwned>(r: &Row<'_>, column: &str) -> rusqlite::Result<T> {
    let index = r.as_ref().column_index(column)?;
    let value: String = r.get(column)?;
    serde_json::from_str(&value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}
