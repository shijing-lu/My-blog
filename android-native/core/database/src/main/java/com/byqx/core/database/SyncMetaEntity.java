package com.byqx.core.database;
import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.PrimaryKey;
@Entity(tableName="sync_meta")
public class SyncMetaEntity {
    @PrimaryKey @NonNull public String serverId = "";
    @NonNull public String cursor = "0";
}
