package com.byqx.core.database;
import androidx.room.*;
import java.util.List;
import kotlinx.coroutines.flow.Flow;
@Dao
public interface NotesDao {
    @Query("SELECT * FROM notes WHERE serverId=:server ORDER BY localUpdatedAt DESC") Flow<List<NoteEntity>> observe(String server);
    @Query("SELECT * FROM notes WHERE serverId=:server AND id=:id") NoteEntity note(String server, String id);
    @Insert(onConflict=OnConflictStrategy.REPLACE) void put(NoteEntity note);
    @Query("SELECT * FROM outbox WHERE serverId=:server ORDER BY rowid LIMIT 50") List<OutboxEntity> pending(String server);
    @Query("SELECT * FROM outbox WHERE serverId=:server AND noteId=:id LIMIT 1") OutboxEntity operation(String server, String id);
    @Insert(onConflict=OnConflictStrategy.ABORT) void enqueue(OutboxEntity operation);
    @Query("DELETE FROM outbox WHERE opId=:opId") void acknowledge(String opId);
    @Insert(onConflict=OnConflictStrategy.ABORT) void conflict(ConflictEntity conflict);
    @Query("SELECT * FROM conflicts WHERE serverId=:server AND noteId=:id AND resolved=0 LIMIT 1") ConflictEntity conflictFor(String server, String id);
    @Query("UPDATE conflicts SET resolved=1 WHERE id=:id") void resolve(String id);
    @Query("SELECT * FROM sync_meta WHERE serverId=:server") SyncMetaEntity meta(String server);
    @Insert(onConflict=OnConflictStrategy.REPLACE) void meta(SyncMetaEntity meta);
}
