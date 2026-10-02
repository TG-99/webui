package main

import (
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"sync"
)

func main() {
	sshAddr := os.Getenv("SSH_ADDR")
	if sshAddr == "" {
		sshAddr = "127.0.0.1:2222"
	}
	panelAddr := os.Getenv("PANEL_ADDR")
	if panelAddr == "" {
		panelAddr = "127.0.0.1:40460"
	}

	// Collect all ports to listen on (80, 443, and $PORT)
	portMap := make(map[string]bool)
	if envPort := os.Getenv("PORT"); envPort != "" {
		for _, p := range strings.Split(envPort, ",") {
			p = strings.TrimSpace(p)
			if p != "" {
				portMap[p] = true
			}
		}
	}
	// Always bind both 80 and 443
	portMap["80"] = true
	portMap["443"] = true

	fmt.Printf("============================================================\n")
	fmt.Printf(" ⚡ Railway WS-SSH & Web Panel Multiplexer\n")
	fmt.Printf(" -> SSH Tunnel Target    : %s\n", sshAddr)
	fmt.Printf(" -> SSH-UI Panel Target  : %s\n", panelAddr)
	fmt.Printf("============================================================\n")

	var wg sync.WaitGroup
	boundCount := 0

	for port := range portMap {
		listener, err := net.Listen("tcp", "0.0.0.0:"+port)
		if err != nil {
			fmt.Printf("[!] Could not bind port %s: %v\n", port, err)
			continue
		}
		boundCount++
		fmt.Printf("[✔] Listening on port %s (WS-SSH + Web Panel)\n", port)

		wg.Add(1)
		go func(l net.Listener, p string) {
			defer wg.Done()
			defer l.Close()
			for {
				client, err := l.Accept()
				if err != nil {
					continue
				}
				go handleConnection(client, sshAddr, panelAddr)
			}
		}(listener, port)
	}

	if boundCount == 0 {
		fmt.Printf("[✘] Failed to bind any port! Exiting...\n")
		os.Exit(1)
	}

	wg.Wait()
}

func handleConnection(client net.Conn, sshAddr, panelAddr string) {
	defer client.Close()

	buf := make([]byte, 4096)
	n, err := client.Read(buf)
	if err != nil || n == 0 {
		return
	}

	reqStr := string(buf[:n])
	reqLower := strings.ToLower(reqStr)

	// Check if this is a WebSocket SSH Tunnel or HTTP Custom / CONNECT request
	isWsUpgrade := strings.Contains(reqLower, "upgrade: websocket") || strings.Contains(reqLower, "connection: upgrade")
	isConnect := strings.HasPrefix(reqStr, "CONNECT ")
	isCustomPayload := strings.Contains(reqLower, "ws-ssh") || strings.Contains(reqLower, "sec-websocket-key")

	isTunnel := (isWsUpgrade || isConnect || isCustomPayload) &&
		!strings.Contains(reqLower, "sec-fetch-dest: document") &&
		!strings.Contains(reqLower, "accept: text/html")

	if isTunnel {
		// Respond with 101 Switching Protocols if HTTP-like request
		if strings.Contains(reqStr, "HTTP/") || isConnect {
			resp := "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n"
			_, err = client.Write([]byte(resp))
			if err != nil {
				return
			}
		}

		sshConn, err := net.Dial("tcp", sshAddr)
		if err != nil {
			return
		}
		defer sshConn.Close()

		// If initial read contains raw SSH greeting/data that wasn't pure HTTP handshake
		if !strings.Contains(reqStr, "HTTP/") && !isConnect {
			_, err = sshConn.Write(buf[:n])
			if err != nil {
				return
			}
		}

		done := make(chan struct{}, 2)
		go func() {
			io.Copy(sshConn, client)
			done <- struct{}{}
		}()
		go func() {
			io.Copy(client, sshConn)
			done <- struct{}{}
		}()
		<-done
		return
	}

	// Otherwise, route HTTP traffic to Flask Web Panel
	panelConn, err := net.Dial("tcp", panelAddr)
	if err != nil {
		resp := "HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/html\r\n\r\n<h3>SSH-UI Web Panel is starting up... Please refresh in a moment.</h3>"
		client.Write([]byte(resp))
		return
	}
	defer panelConn.Close()

	// Forward the initial HTTP request buffer
	_, err = panelConn.Write(buf[:n])
	if err != nil {
		return
	}

	done := make(chan struct{}, 2)
	go func() {
		io.Copy(panelConn, client)
		done <- struct{}{}
	}()
	go func() {
		io.Copy(client, panelConn)
		done <- struct{}{}
	}()
	<-done
}
