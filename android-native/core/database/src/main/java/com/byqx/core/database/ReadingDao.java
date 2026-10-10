package com.byqx.core.database;
import androidx.room.*;
import java.util.List;
import kotlinx.coroutines.flow.Flow;
@Dao public interface ReadingDao {
    @Query("SELECT * FROM reading_cache WHERE serverId=:server AND (cacheKey='catalog' OR cacheKey='display' OR cacheKey LIKE 'article:%')") Flow<List<ReadingCacheEntity>> observe(String server);
    @Query("SELECT * FROM reading_cache WHERE serverId=:server AND cacheKey=:key") ReadingCacheEntity get(String server,String key);
    @Insert(onConflict=OnConflictStrategy.REPLACE) void put(ReadingCacheEntity cache);
    @Query("SELECT * FROM reading_positions WHERE serverId=:server AND articleId=:id") ReadingPositionEntity position(String server,String id);
    @Insert(onConflict=OnConflictStrategy.REPLACE) void position(ReadingPositionEntity position);
}
