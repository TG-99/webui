package main

import (
	"fmt"
	"os"
	"os/exec"
	"sync"
)

// RunScript executes a shell command and logs its output and errors.
func RunScript(command string, logFile string, wg *sync.WaitGroup) {
	defer wg.Done()

	// Open or create the log file
	log, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		fmt.Printf("Error opening log file %s: %v\n", logFile, err)
		return
	}
	defer log.Close()

	// Execute the command using bash -c to allow full shell syntax
	cmd := exec.Command("bash", "-c", command)
	cmd.Stdout = log
	cmd.Stderr = log

	err = cmd.Run()
	if err != nil {
		fmt.Printf("Error running command '%s': %v\n", command, err)
		return
	}
	fmt.Printf("Command '%s' completed successfully.\n", command)
}

func main() {
	// Ensure the script directory exists (optional)
	err := os.MkdirAll("./script", os.ModePerm)
	if err != nil {
		fmt.Printf("Error creating script directory: %v\n", err)
		return
	}

	var wg sync.WaitGroup

	// Define commands and log files
	scripts := []struct {
		command string
		logFile string
	}{
		{"./script/nginx.sh", "nginx.txt"},
		{"./script/alist.sh", "alist.txt"},
		{"./script/vs.sh", "vs.txt"},
		{"./script/ttyd.sh", "ttyd.txt"},
		{"python3 ./script/alive.py", "alive.txt"},
	}

	// Launch each command concurrently
	for _, script := range scripts {
		wg.Add(1)
		go RunScript(script.command, script.logFile, &wg)
	}

	wg.Wait()
	fmt.Println("All processes completed.")
}
