package main

import (
	"fmt"
	"os"
	"os/exec"
	"sync"
)

// RunScript executes a shell script with given arguments and logs errors.
func RunScript(scriptPath string, logFile string, wg *sync.WaitGroup) {
	defer wg.Done()

	// Open log file for appending
	log, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		fmt.Printf("Error opening log file %s: %v\n", logFile, err)
		return
	}
	defer log.Close()

	cmd := exec.Command("bash", scriptPath)
	// Example for redirecting stderr to a log file
	cmd.Stderr = log

	err = cmd.Run()
	if err != nil {
		fmt.Printf("Error running script %s: %v\n", scriptPath, err)
		return
	}
	fmt.Printf("Script %s completed successfully.\n", scriptPath)
}

func main() {
	os.MkdirAll("./script", os.ModePerm)

	var wg sync.WaitGroup

	// Define scripts to execute
	scripts := []struct {
		scriptPath string
		logFile    string
	}{
		{"./script/fb.sh", "fb.log"},
		{"./script/ttyd.sh", "ttyd.log"},
		{"./script/alist.sh", "alist.log"},
		{"./script/nginx.sh", "nginx.log"},
	}

	// Execute scripts concurrently
	for _, script := range scripts {
		wg.Add(1)
		go RunScript(script.scriptPath, script.logFile, &wg)
	}

	wg.Wait()
	fmt.Println("All processes completed.")
}