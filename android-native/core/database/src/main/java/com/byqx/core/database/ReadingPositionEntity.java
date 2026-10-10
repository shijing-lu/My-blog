package com.byqx.core.database;
import androidx.room.*;
import androidx.annotation.NonNull;
@Entity(tableName="reading_positions",primaryKeys={"serverId","articleId"})
public class ReadingPositionEntity {
    @NonNull public String serverId="";
    @NonNull public String articleId="";
    public int itemIndex;
    public int offset;
}
