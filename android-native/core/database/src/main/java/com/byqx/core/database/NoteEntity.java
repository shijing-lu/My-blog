package com.byqx.core.database;
import androidx.annotation.NonNull;
import androidx.room.Entity;
@Entity(tableName="notes", primaryKeys={"serverId","id"})
public class NoteEntity {
    @NonNull public String serverId = "";
    @NonNull public String id = "";
    public String payload;
    public String basePayload;
    public String revision;
    public long serverSeq;
    public String draft;
    public boolean conflicted;
    public long localUpdatedAt;
}
