package com.byqx.core.database;
import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.PrimaryKey;
@Entity(tableName="outbox")
public class OutboxEntity {
    @PrimaryKey @NonNull public String opId = "";
    @NonNull public String serverId = "";
    @NonNull public String noteId = "";
    public String baseRevision;
    public String basePayload;
    public String payload;
}
