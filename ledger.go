package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

type ledger struct {
	Score     int64                      `json:"score"`
	Completed map[string]map[string]bool `json:"completed"`
	Painted   map[string]map[string]bool `json:"painted"`
}

func newLedger() ledger {
	return ledger{Completed: make(map[string]map[string]bool), Painted: make(map[string]map[string]bool)}
}

type progress struct {
	Regular  ledger `json:"regular"`
	Hardcore ledger `json:"hardcore"`
}

type state struct {
	Progress progress `json:"progress"`
	Epoch    int64    `json:"epoch"`
}

func initialState() *state {
	return &state{Progress: progress{Regular: newLedger(), Hardcore: newLedger()}}
}

type change struct {
	Type     string    `json:"type"`
	Key      string    `json:"key"`
	ID       string    `json:"id"`
	Points   int64     `json:"points"`
	Epoch    int64     `json:"epoch"`
	Progress *progress `json:"progress"`
}

type atlasIDs map[string]map[string]bool

func loadAtlasIDs(web fs.FS) (atlasIDs, error) {
	type item struct{ ID string }
	type atlas struct{ Countries []item }
	read := func(name, prefix string, destination any) error {
		data, err := fs.ReadFile(web, name)
		if err != nil {
			return err
		}
		data = bytes.TrimSpace(data)
		if !bytes.HasPrefix(data, []byte(prefix)) || !bytes.HasSuffix(data, []byte(";")) {
			return errors.New("invalid atlas data")
		}
		return json.Unmarshal(data[len(prefix):len(data)-1], destination)
	}
	var countries atlas
	if err := read("world.js", "const WORLD = ", &countries); err != nil {
		return nil, err
	}
	var sets map[string]atlas
	if err := read("atlases.js", "const ATLAS_DATA = ", &sets); err != nil {
		return nil, err
	}
	sets["countries"] = countries
	result := make(atlasIDs)
	for _, key := range []string{"countries", "japan", "russia", "usa"} {
		result[key] = make(map[string]bool)
		for _, item := range sets[key].Countries {
			result[key][item.ID] = true
		}
		if len(result[key]) == 0 {
			return nil, errors.New("empty atlas set: " + key)
		}
	}
	return result, nil
}

func (a atlasIDs) answer(key, id string) (set string, hard bool, max int64) {
	parts := strings.Split(key, ":")
	if len(parts) != 3 || !a[parts[1]][id] {
		return "", false, 0
	}
	switch parts[2] {
	case "quick":
	case "full", "flags", "arms", "capitals", "reverse":
		if parts[1] != "countries" {
			return "", false, 0
		}
	default:
		return "", false, 0
	}
	switch parts[0] {
	case "easy":
		max = 40
	case "normal":
		max = 100
	case "hard":
		max = 140
	case "hardcore":
		max = 200
	default:
		return "", false, 0
	}
	return parts[1], parts[0] == "hardcore", max
}

func (l *ledger) award(key, set, id string, points int64) bool {
	if l.Completed[key] == nil {
		l.Completed[key] = make(map[string]bool)
	}
	if l.Completed[key][id] {
		return false
	}
	l.Completed[key][id] = true
	if l.Painted[set] == nil {
		l.Painted[set] = make(map[string]bool)
	}
	l.Painted[set][id] = true
	l.Score += points
	return true
}

func (a atlasIDs) importLedger(source ledger, hard bool) ledger {
	target := newLedger()
	var limit int64
	for key, entries := range source.Completed {
		for id, value := range entries {
			set, isHard, max := a.answer(key, id)
			if value && max > 0 && hard == isHard && target.award(key, set, id, 0) {
				limit += max
			}
		}
	}
	target.Score = max(0, min(source.Score, limit))
	return target
}

func (a atlasIDs) apply(previous *state, changes []change) *state {
	first := previous == nil
	if first {
		previous = initialState()
	}
	for _, event := range changes {
		switch event.Type {
		case "import":
			if first && event.Progress != nil {
				previous.Progress.Regular = a.importLedger(event.Progress.Regular, false)
				previous.Progress.Hardcore = a.importLedger(event.Progress.Hardcore, true)
			}
		case "reset":
			if event.Epoch == previous.Epoch {
				previous.Progress.Hardcore = newLedger()
				previous.Epoch++
			}
		case "solve":
			set, hard, max := a.answer(event.Key, event.ID)
			if max == 0 || event.Points < 0 || event.Points > max {
				continue
			}
			if hard {
				if event.Epoch == previous.Epoch {
					previous.Progress.Hardcore.award(event.Key, set, event.ID, event.Points)
				}
			} else {
				previous.Progress.Regular.award(event.Key, set, event.ID, event.Points)
			}
		}
		first = false
	}
	return previous
}

const recordLimit = 256 * 1024
const storageCap int64 = 280_000_000

var accountFormat = regexp.MustCompile(`^[a-f0-9]{64}$`)
var errStorageFull = errors.New("progress storage is full")

type diskStore struct {
	dir       string
	used, cap int64
	mu        sync.Mutex
	atlases   atlasIDs
}

func diskCost(size int64) int64 { return ((size+4095)/4096 + 1) * 4096 }

func openStore(dir string, cap int64, atlases atlasIDs) (*diskStore, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	handle, err := os.Open(dir)
	if err != nil {
		return nil, err
	}
	defer handle.Close()
	s := &diskStore{dir: dir, cap: cap, atlases: atlases}
	for {
		entries, err := handle.Readdir(128)
		for _, entry := range entries {
			if !entry.Mode().IsRegular() {
				continue
			}
			if strings.HasPrefix(entry.Name(), ".terra-write-") {
				if err := os.Remove(filepath.Join(dir, entry.Name())); err == nil {
					continue
				}
			}
			s.used += diskCost(entry.Size())
		}
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
	}
	return s, nil
}

func (s *diskStore) path(account string) (string, error) {
	if !accountFormat.MatchString(account) {
		return "", errors.New("invalid account")
	}
	return filepath.Join(s.dir, account+".json"), nil
}

func readRecord(path string) (*state, int64, error) {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, 0, nil
	}
	if err != nil {
		return nil, 0, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, recordLimit+1))
	if err != nil {
		return nil, 0, err
	}
	if len(data) > recordLimit {
		return nil, 0, errors.New("invalid record size")
	}
	var record state
	if err := json.Unmarshal(data, &record); err != nil {
		return nil, 0, err
	}
	return &record, diskCost(int64(len(data))), nil
}

func (s *diskStore) get(account string) (*state, error) {
	path, err := s.path(account)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	value, _, err := readRecord(path)
	return value, err
}

func (s *diskStore) update(account string, changes []change) (*state, error) {
	path, err := s.path(account)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, oldCost, err := readRecord(path)
	if err != nil {
		return nil, err
	}
	value := s.atlases.apply(previous, changes)
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	cost := diskCost(int64(len(data)))
	if len(data) > recordLimit || s.used+cost > s.cap {
		return nil, errStorageFull
	}
	file, err := os.CreateTemp(s.dir, ".terra-write-")
	if err != nil {
		return nil, err
	}
	defer os.Remove(file.Name())
	_, writeErr := file.Write(data)
	if writeErr == nil {
		writeErr = file.Sync()
	}
	closeErr := file.Close()
	if writeErr != nil {
		return nil, writeErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if err := os.Rename(file.Name(), path); err != nil {
		return nil, err
	}
	s.used += cost - oldCost
	return value, nil
}
