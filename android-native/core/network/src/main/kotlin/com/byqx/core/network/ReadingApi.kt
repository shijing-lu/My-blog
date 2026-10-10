package com.byqx.core.network
import kotlinx.serialization.Serializable
import retrofit2.http.*
@Serializable data class ArticleDto(val id:String,val title:String,val slug:String,val type:String,val summary:String="",val cover:String?=null,val tags:List<String> = emptyList(),val encrypted:Boolean=false,val createdAt:Long,val updatedAt:Long,val categoryId:String?=null,val views:Int=0)
@Serializable data class CategoryDto(val id:String,val name:String,val parentId:String?=null,val color:String="",val sort:Int=0)
@Serializable data class LandingDto(val images:List<String> = emptyList(),val intervalSec:Int=6,val animation:String="slide",val subtitle:String="")
@Serializable data class QuoteDto(val text:String,val pauseMs:Int?=null)
@Serializable data class QuotesDto(val quotes:List<QuoteDto> = emptyList(),val charIntervalMs:Int=100,val defaultPauseMs:Int=5000)
@Serializable data class CatalogDto(val protocolVersion:Int,val serverId:String,val articles:List<ArticleDto>,val categories:List<CategoryDto>,val landing:LandingDto=LandingDto(),val quotes:QuotesDto=QuotesDto())
@Serializable data class ReadingDisplayDto(val protocolVersion:Int,val serverId:String,val landing:LandingDto,val quotes:QuotesDto)
@Serializable data class ReadingRequest(val serverId:String,val id:String,val password:String?=null,val liked:Boolean?=null) { override fun toString()="ReadingRequest([redacted])" }
@Serializable data class ArticleDetailDto(val protocolVersion:Int,val serverId:String,val article:ArticleDto,val source:String,val sourceVersion:String,val views:Int=0,val likes:Int=0,val liked:Boolean=false) { override fun toString()="ArticleDetailDto([redacted])" }
@Serializable data class ReadingInteractionDto(val views:Int,val likes:Int,val liked:Boolean)
@Serializable data class ArticleSearchDto(val protocolVersion:Int,val serverId:String,val articles:List<ArticleDto>)
interface ReadingApi {
    @GET("api/mobile/v1/reading/catalog") suspend fun catalog(@Header("Authorization") bearer:String):CatalogDto
    @POST("api/mobile/v1/reading/detail") suspend fun detail(@Header("Authorization") bearer:String,@Body body:ReadingRequest):ArticleDetailDto
    @POST("api/mobile/v1/reading/view") suspend fun view(@Header("Authorization") bearer:String,@Body body:ReadingRequest):ReadingInteractionDto
    @POST("api/mobile/v1/reading/like") suspend fun like(@Header("Authorization") bearer:String,@Body body:ReadingRequest):ReadingInteractionDto
    @GET("api/mobile/v1/reading/search") suspend fun search(@Header("Authorization") bearer:String,@Query("q") query:String):ArticleSearchDto
    @GET("api/mobile/v1/reading/display") suspend fun display(@Header("Authorization") bearer:String):ReadingDisplayDto
}
