package com.byqx.core.database;
import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.PrimaryKey;
@Entity(tableName="conflicts")
public class ConflictEntity {
    @PrimaryKey @NonNull public String id = "";
    @NonNull public String serverId = "";
    @NonNull public String noteId = "";
    public String basePayload;
    public String localPayload;
    public String remotePayload;
    public String remoteRevision;
    public long remoteSeq;
    public boolean resolved;
}
