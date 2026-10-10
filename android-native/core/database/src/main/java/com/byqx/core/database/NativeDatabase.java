package com.byqx.core.database;
import androidx.room.*;
@Database(entities={NoteEntity.class,OutboxEntity.class,ConflictEntity.class,SyncMetaEntity.class,ReadingCacheEntity.class,ReadingPositionEntity.class}, version=2, exportSchema=true)
public abstract class NativeDatabase extends RoomDatabase {
    public abstract NotesDao notes();
    public abstract ReadingDao reading();
    public static final androidx.room.migration.Migration MIGRATION_1_2 = new androidx.room.migration.Migration(1,2) {
        @Override public void migrate(@androidx.annotation.NonNull androidx.sqlite.db.SupportSQLiteDatabase db) {
            db.execSQL("CREATE TABLE IF NOT EXISTS reading_cache (serverId TEXT NOT NULL, cacheKey TEXT NOT NULL, payload TEXT NOT NULL, fetchedAt INTEGER NOT NULL, PRIMARY KEY(serverId,cacheKey))");
            db.execSQL("CREATE TABLE IF NOT EXISTS reading_positions (serverId TEXT NOT NULL, articleId TEXT NOT NULL, itemIndex INTEGER NOT NULL, offset INTEGER NOT NULL, PRIMARY KEY(serverId,articleId))");
        }
    };
}
