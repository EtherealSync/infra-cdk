package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/dynamodb"
	"github.com/aws/aws-sdk-go/service/dynamodb/dynamodbattribute"
	"github.com/aws/aws-sdk-go/service/s3"
	"github.com/joho/godotenv"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/googleapi"
	"google.golang.org/api/option"
	"google.golang.org/api/youtube/v3"
)

type Channel struct {
	PK              string
	SK              string
	TokenIssuedAt   int64
	Scope           string
	RefreshToken    string
	AccessToken     string
	TokenExpiryDate int64
	TokenType       string
	UserId          string
}

type YtVideo struct {
	PK                   string
	SK                   string
	VideoTitle           string
	VideoDescription     string
	Status               string
	UploadedToPlatformAt int64
	UserId               string
	ThumbnailKey         string
}

func main() {

	type StatusType string

	const (
		AwaitingApproval  StatusType = "awaiting_approval"
		RejectedByCreator StatusType = "rejected_by_creator"
		UploadedToYT      StatusType = "uploaded_to_yt"
		UploadingToYT     StatusType = "uploading_to_yt"
		Failed            StatusType = "failed"
	)
	err := godotenv.Load(".env")

	if err != nil {
		log.Fatal("Error loading .env file")
	}

	// remove in prod

	channelSK := os.Getenv("CHANNEL_SK")
	projectSK := os.Getenv("PROJECT_SK")
	orgSK := os.Getenv("ORG_SK")
	videoSK := os.Getenv("VIDEO_SK")

	googleClientId := os.Getenv("GOOGLE_CLIENT_ID")
	googleClientSecret := os.Getenv("GOOGLE_CLIENT_SECRET")
	tableName := os.Getenv("TABLE_NAME")
	bucketName := os.Getenv("YT_UPLOADS_S3_BUCKET_NAME")
	region := os.Getenv("REGION")

	if channelSK == "" {
		log.Fatal("CHANNEL_SK is missing.")
	}

	if projectSK == "" {
		log.Fatal("PROJECT_SK is missing.")
	}

	if orgSK == "" {
		log.Fatal("ORG_SK is missing.")
	}

	if videoSK == "" {
		log.Fatal("VIDEO_SK is missing.")
	}

	if googleClientId == "" {
		log.Fatal("GOOGLE_CLIENT_ID is missing.")
	}

	if googleClientSecret == "" {
		log.Fatal("GOOGLE_CLIENT_SECRET is missing.")
	}

	if tableName == "" {
		log.Fatal("TABLE_NAME is missing.")
	}

	if bucketName == "" {
		log.Fatal("YT_UPLOADS_S3_BUCKET_NAME is missing.")
	}

	if region == "" {
		log.Fatal("REGION is missing.")
	}

	// Create a new AWS session with your credentials and region
	// remove credentials in prod
	sess, err := session.NewSession(&aws.Config{
		Region: aws.String(region),
		// Credentials: credentials.NewStaticCredentials(accessKey, secretKey, ""),
	})

	if err != nil {
		log.Fatal("Error initializing AWS session:", err)
	}

	// Create a new S3 client using the session
	s3Client := s3.New(sess)
	// Create a new DynamoDb client using the session
	dbClient := dynamodb.New(sess)

	// Define the DynamoDB input parameters to update the video status
	updateInput := &dynamodb.UpdateItemInput{
		TableName: aws.String(tableName),
		Key: map[string]*dynamodb.AttributeValue{
			"PK": {
				S: aws.String(fmt.Sprintf("%s#%s", orgSK, projectSK)),
			},
			"SK": {
				S: aws.String(fmt.Sprintf("%s", videoSK)),
			},
		},
		ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
			":newStatus": {
				S: aws.String(string(UploadingToYT)),
			},
		},
		ExpressionAttributeNames: map[string]*string{
			"#status": aws.String("Status"), // Use PascalCase attribute name
		},
		UpdateExpression: aws.String("SET #status = :newStatus"),
	}

	// Update the video status in DynamoDB
	_, err1 := dbClient.UpdateItem(updateInput)
	if err1 != nil {
		log.Fatal("Failed to update video status:", err)
	} else {
		log.Println("Updated video status to uploading_to_yt")
	}

	// Define the DynamoDB input parameters to get channel data
	channelInput := &dynamodb.GetItemInput{
		TableName: aws.String(tableName),
		Key: map[string]*dynamodb.AttributeValue{
			"PK": {
				S: aws.String(orgSK),
			},
			"SK": {
				S: aws.String(channelSK),
			},
		},
	}
	// Retrieve the channel item from DynamoDB
	channelResult, err := dbClient.GetItem(channelInput)
	if err != nil {
		log.Fatal("Error retrieving channel item from DynamoDB", err)
	}

	// Check if the item exists in the result
	if channelResult.Item == nil {
		log.Fatal("Channel item not found in DynamoDB")
	}

	// Unmarshal the DynamoDB channel item into a channel struct
	retrievedChannel := Channel{}
	if err := dynamodbattribute.UnmarshalMap(channelResult.Item, &retrievedChannel); err != nil {
		log.Fatal("Error unmarshaling DynamoDB channel item:", err)
	}
	// Retrieve the access token and refresh token for the retrieved channel
	accessToken := retrievedChannel.AccessToken
	refreshToken := retrievedChannel.RefreshToken
	tokenExpiryDate := retrievedChannel.TokenExpiryDate

	expiryTime := time.Unix(tokenExpiryDate/1000, 0)

	fmt.Println("access token expiry time: ", expiryTime)

	config := oauth2.Config{
		ClientID:     googleClientId,
		ClientSecret: googleClientSecret,
		Endpoint:     google.Endpoint,
		RedirectURL:  "urn:ietf:wg:oauth:2.0:oob",
	}

	// Check if the token has expired
	if expiryTime.Before(time.Now()) {
		// Create a token source using the refresh token.
		tokenSource := config.TokenSource(context.TODO(), &oauth2.Token{
			RefreshToken: refreshToken,
			AccessToken:  accessToken,
			Expiry:       expiryTime,
		})

		// Request a new access token using the refresh token.
		newToken, err := tokenSource.Token()
		if err != nil {
			log.Fatal("Failed to refresh access token:", err)
		}
		// Update your accessToken and expiryTime with the new token values.
		accessToken = newToken.AccessToken
		expiryTime = newToken.Expiry

		// Update the database with new access token, issue date, and expiration date
		tokenExpiryDate := newToken.Expiry.Unix() * 1000
		tokenIssuedAt := time.Now().UnixNano() / int64(time.Millisecond)

		updateInput := &dynamodb.UpdateItemInput{
			TableName: aws.String(tableName),
			Key: map[string]*dynamodb.AttributeValue{
				"PK": {
					S: aws.String(orgSK),
				},
				"SK": {
					S: aws.String(channelSK),
				},
			},
			ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
				":at": {
					S: aws.String(newToken.AccessToken),
				},
				":expiry": {
					N: aws.String(strconv.FormatInt(tokenExpiryDate, 10)),
				},
				":issuedAt": {
					N: aws.String(strconv.FormatInt(tokenIssuedAt, 10)),
				},
			},
			UpdateExpression: aws.String("SET accessToken = :at, tokenExpiryDate = :expiry, tokenIssuedAt = :issuedAt"),
		}
		_, err2 := dbClient.UpdateItem(updateInput)
		if err2 != nil {
			log.Fatal("Failed to update access token:", err2)
		} else {
			log.Println("Updated access token, tokenExpiryDate, and tokenIssuedAt")
		}
	} else {
		fmt.Println("Using old access token: ", "Expiry time: ", expiryTime, "Current time: ", time.Now())
	}

	// Create an HTTP client with the token
	httpClient := config.Client(context.TODO(), &oauth2.Token{
		RefreshToken: refreshToken,
		AccessToken:  accessToken,
		Expiry:       expiryTime,
	})

	yt, err := youtube.NewService(context.TODO(), option.WithHTTPClient(httpClient))
	if err != nil {
		log.Fatal("Error creating YouTubwe service client:", err)
	}

	// Defining the DynamoDB input parameters to get video data
	videoInput := &dynamodb.GetItemInput{
		TableName: aws.String(tableName),
		Key: map[string]*dynamodb.AttributeValue{
			"PK": {
				S: aws.String(fmt.Sprintf("%s#%s", orgSK, projectSK)),
			},
			"SK": {
				S: aws.String(videoSK),
			},
		},
	}

	// Retrieve the video item from DynamoDB
	videoResult, err := dbClient.GetItem(videoInput)
	if err != nil {
		log.Fatal("Error retrieving video item from DynamoDB", err)
	}

	// Check if the item exists in the result
	if videoResult.Item == nil {
		log.Fatal("Video item not found in DynamoDB")
	}

	// Unmarshal the DynamoDB channel item into a channel struct
	retrievedVideo := YtVideo{}
	if err := dynamodbattribute.UnmarshalMap(videoResult.Item, &retrievedVideo); err != nil {
		log.Fatal("Error unmarshaling DynamoDB video item:", err)
	}

	video := &youtube.Video{
		Snippet: &youtube.VideoSnippet{
			Title:       fmt.Sprintf("%v", retrievedVideo.VideoTitle),
			Description: fmt.Sprintf("%v", retrievedVideo.VideoDescription),
		},
		Status: &youtube.VideoStatus{PrivacyStatus: "private"},
	}

	log.Println("Getting object from s3")
	videoObjectResult, err := s3Client.GetObject(&s3.GetObjectInput{
		Bucket: aws.String(bucketName),
		Key:    aws.String(removeVideoPrefix(videoSK)),
	})
	if err != nil {
		log.Fatal("Error getting stream from from S3:", err)
	}

	insertRequest := yt.Videos.Insert([]string{"snippet", "status"}, video)
	insertRequest = insertRequest.Media(videoObjectResult.Body, googleapi.ContentType("video/*"))

	log.Println("Starting upload to youtube")

	res, err := insertRequest.Do()
	if err != nil {
		log.Fatal("Error uploading video:", err)
	}

	log.Printf("Video uploaded! Video ID: %s\n", res.Id)

	// Mark the video status as uploaded
	updateInputMarkUploaded := &dynamodb.UpdateItemInput{
		TableName: aws.String(tableName),
		Key: map[string]*dynamodb.AttributeValue{
			"PK": {
				S: aws.String(fmt.Sprintf("%s#%s", orgSK, projectSK)),
			},
			"SK": {
				S: aws.String(fmt.Sprintf("%s", videoSK)),
			},
		},
		ExpressionAttributeValues: map[string]*dynamodb.AttributeValue{
			":newStatus": {
				S: aws.String(string(UploadedToYT)), // Use the correct status value
			},
		},
		ExpressionAttributeNames: map[string]*string{
			"#status": aws.String("Status"), // Use PascalCase attribute name
		},
		UpdateExpression: aws.String("SET #status = :newStatus"),
	}

	// Update the video status in DynamoDB
	_, err3 := dbClient.UpdateItem(updateInputMarkUploaded)
	if err3 != nil {
		log.Fatal("Failed to update video status:", err3) // Use err3 instead of err
	} else {
		log.Println("Updated video status to UploadedToYT")
	}

}

func removeVideoPrefix(input string) string {
	return strings.TrimPrefix(input, "VIDEO#")
}

// Discarded Codes
// // Create an OAuth2 token
// token := &oauth2.Token{
// 	AccessToken: accessToken,
// 	// RefreshToken: refreshToken,
// 	TokenType: "Bearer",
// 	// Expiry:       time.Now(),
// }

// List and print all channels
// part := []string{"snippet", "contentDetails", "statistics"}
// channelsListCall := yt.Channels.List(part).Mine(true)
// response, err := channelsListCall.Do()
// if err != nil {
// 	log.Println("Error listing channels:", err)
// 	return
// }

// for _, channel := range response.Items {
// 	log.Println("Channel ID:", channel.Id)
// 	log.Println("Channel Title:", channel.Snippet.Title)
// 	log.Println("Channel Description:", channel.Snippet.Description)
// 	log.Println()
// }
