package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/googleapi"
	"google.golang.org/api/youtube/v3"
)

func main() {

	payloadJSON := os.Getenv("SST_PAYLOAD")

	var payload map[string]interface{}
	err := json.Unmarshal([]byte(payloadJSON), &payload)
	if err != nil {
		panic(err)
	}

	clientID := ""
	clientSecret := ""

	accessToken := fmt.Sprintf("%v", payload["ACCESS_TOKEN"])
	refreshToken := fmt.Sprintf("%v", payload["REFRESH_TOKEN"]) //from dynamo db query

	bucketName := fmt.Sprintf("%v", payload["BUCKET_NAME"])
	objectKey := fmt.Sprintf("%v", payload["OBJECT_KEY"])

	config := oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		Endpoint:     google.Endpoint,
		RedirectURL:  "urn:ietf:wg:oauth:2.0:oob",
	}

	token := &oauth2.Token{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		Expiry:       time.Now(),
	}

	client := config.Client(oauth2.NoContext, token)

	youtubeService, err := youtube.New(client)
	if err != nil {
		fmt.Println("Error creating YouTubwe service client:", err)
		return
	}

	sess, err := session.NewSession(&aws.Config{
		Region: aws.String("ap-south-1"),
	})
	if err != nil {
		fmt.Println("Error initializing AWS session:", err)
		return
	}
	s3Client := s3.New(sess)

	pipeReader, pipeWriter := io.Pipe()

	go func() {
		defer pipeWriter.Close()

		fmt.Println("Starting upload to s3")
		result, err := s3Client.GetObject(&s3.GetObjectInput{
			Bucket: aws.String(bucketName),
			Key:    aws.String(objectKey),
		})
		if err != nil {
			fmt.Println("Error downloading video from S3:", err)
			return
		}

		_, err = io.Copy(pipeWriter, result.Body)
		if err != nil {
			fmt.Println("Error copying video data to pipe:", err)
			return
		}
	}()

	video := &youtube.Video{
		Snippet: &youtube.VideoSnippet{
			Title:       fmt.Sprintf("%v", payload["TITLE"]),
			Description: fmt.Sprintf("%v", payload["DESCRIPTION"]),
		},
		Status: &youtube.VideoStatus{PrivacyStatus: "private"},
	}

	insertRequest := youtubeService.Videos.Insert([]string{"snippet", "status"}, video)
	insertRequest = insertRequest.Media(pipeReader, googleapi.ContentType("video/*"))

	fmt.Println("Starting upload to youtube")
	response, err := insertRequest.Do()
	if err != nil {
		fmt.Println("Error uploading video:", err)
		return
	}

	fmt.Printf("Video uploaded! Video ID: %s\n", response.Id)

}
