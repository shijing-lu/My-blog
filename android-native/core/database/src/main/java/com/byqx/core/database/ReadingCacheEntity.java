package com.byqx.core.database;
import androidx.room.*;
import androidx.annotation.NonNull;
@Entity(tableName="reading_cache", primaryKeys={"serverId","cacheKey"})
public class ReadingCacheEntity {
    @NonNull public String serverId="";
    @NonNull public String cacheKey="";
    @NonNull public String payload="";
    public long fetchedAt;
}
